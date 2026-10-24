import { execFile } from "node:child_process";
import { cliEnv } from "./env";
import type { Backend, CliStatus } from "./types";
import { binary, cleanOutput as clean, message } from "./login";

// Checks whether a CLI is logged in by running `<cli> auth status --json`. The CLI prints the
// JSON whether it succeeds or not, so a logged-out CLI can exit non-zero and still report its
// state. We time out and cap the buffer in case the CLI hangs.
//
// Claude Code and puku-cli print JSON. Codex and Goose print text, each with its own command:
// Codex has `login status`, Goose has `info --check` (there is no `goose auth`).

const STATUS_TIMEOUT_MS = 10_000;

function parseStatus(stdout: string): CliStatus | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const data = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof data.loggedIn !== "boolean") return null;
    return typeof data.email === "string" && data.email
      ? { loggedIn: data.loggedIn, email: data.email }
      : { loggedIn: data.loggedIn };
  } catch {
    return null;
  }
}

function parseCodexStatus(stdout: string, stderr: string): CliStatus | null {
  const text = clean(`${stdout}\n${stderr}`).trim();
  if (/not logged in|not authenticated|no auth(?:entication)? (?:data|credentials)|logged out/i.test(text)) {
    return { loggedIn: false };
  }
  if (/logged in|authenticated/i.test(text)) return { loggedIn: true };
  return null;
}

// Goose's `info --check` reports a provider check, not a login: it names what it found and
// says whether the connection works. The shape is a "Provider Check:" block whose lines name
// the parts — "Provider:", "Model:", "Auth:" — each of which is either fine, "not configured",
// or "FAILED <why>". A check with no failing part means the key is there and good.
//
// The check talks to the provider, so it costs a request; it is the only status Goose offers.
function parseGooseStatus(stdout: string, stderr: string): CliStatus | null {
  const text = clean(`${stdout}\n${stderr}`).trim();
  if (!/provider check/i.test(text)) return null;
  // A part that isn't set, or a check that failed: the key isn't usable.
  if (/not configured|configuration value not found/i.test(text)) return { loggedIn: false };
  if (/\bFAILED\b|authentication error|unauthorized|provider check failed/i.test(text)) return { loggedIn: false };
  // Every part named and none failing: the provider is configured and reachable.
  if (/\bProvider:|\bModel:|\bAuth:/i.test(text)) return { loggedIn: true };
  return null;
}

export async function authStatus(backend: Backend): Promise<CliStatus> {
  let bin: string;
  try {
    bin = binary(backend);
  } catch (err) {
    return { loggedIn: false, error: message(err) };
  }
  return new Promise((resolve) => {
    // A logged-out CLI can exit non-zero and still print its status.
    const args = backend === "codex"
      ? ["login", "status"]
      : backend === "goose"
        ? ["info", "--check"]
        : ["auth", "status", "--json"];
    const env = cliEnv();
    if (backend === "codex") delete env.CLAUDE_CODE_ENTRYPOINT;
    execFile(
      bin,
      args,
      { env, timeout: STATUS_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout: string | undefined, stderr: string | undefined) => {
        const status = backend === "codex"
          ? parseCodexStatus(stdout ?? "", stderr ?? "")
          : backend === "goose"
            ? parseGooseStatus(stdout ?? "", stderr ?? "")
            : parseStatus(stdout ?? "");
        if (status) {
          resolve(status);
          return;
        }
        const detail = clean(stderr ?? "").trim() || (err ? message(err) : "") || "No status in the CLI's output.";
        resolve({ loggedIn: false, error: detail.slice(0, 500) });
      },
    );
  });
}
