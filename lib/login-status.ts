import { execFile } from "node:child_process";
import { ANTIGRAVITY_STATUS_ARGS, antigravityAuthMode, antigravityWarning, parseAntigravityStatus } from "./antigravity-login";
import { cliEnv } from "./env";
import { githubCopilotStatus } from "./github-copilot-client";
import { spawnPlan } from "./win-command";
import type { Backend, CliStatus } from "./types";
import { binary, cleanOutput as clean, message } from "./login";

// Checks whether a CLI is logged in by running `<cli> auth status --json`. The CLI prints the
// JSON whether it succeeds or not, so a logged-out CLI can exit non-zero and still report its
// state. We time out and cap the buffer in case the CLI hangs.
//
// Claude Code and puku-cli print JSON. Codex and Goose print text, each with its own command:
// Codex has `login status`, Goose has `info --check` (there is no `goose auth`). Antigravity has no status
// command: `agy -p /usage --output-format json` needs a sign-in, so it answers SUCCESS or "authentication required".

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

// Each CLI's status command and how to read it; the rest run `auth status --json` and print JSON.
const CHECKS: Partial<Record<Backend, { args: string[]; parse: (stdout: string, stderr: string) => CliStatus | null }>> = {
  codex: { args: ["login", "status"], parse: parseCodexStatus },
  goose: { args: ["info", "--check"], parse: parseGooseStatus },
  antigravity: { args: ANTIGRAVITY_STATUS_ARGS, parse: parseAntigravityStatus },
};
const JSON_CHECK = { args: ["auth", "status", "--json"], parse: (stdout: string) => parseStatus(stdout) };

// A Google-account sign-in is one Google says not to wrap in another app: Antigravity's status says so under its row.
function withWarning(backend: Backend, status: CliStatus): CliStatus {
  const warning = backend === "antigravity" && status.loggedIn ? antigravityWarning(antigravityAuthMode()) : undefined;
  return warning ? { ...status, warning } : status;
}

export async function authStatus(backend: Backend): Promise<CliStatus> {
  if (backend === "github-copilot") return githubCopilotStatus();
  let bin: string;
  try {
    bin = binary(backend);
  } catch (err) {
    return { loggedIn: false, error: message(err) };
  }
  return new Promise((resolve) => {
    // A logged-out CLI can exit non-zero and still print its status.
    const check = CHECKS[backend] ?? JSON_CHECK;
    const env = cliEnv();
    if (backend === "codex") delete env.CLAUDE_CODE_ENTRYPOINT;
    const plan = spawnPlan(bin, check.args, { env });
    execFile(
      plan.command,
      plan.args,
      { env, timeout: STATUS_TIMEOUT_MS, maxBuffer: 1024 * 1024, ...(plan.windowsVerbatimArguments && { windowsVerbatimArguments: true }) },
      (err, stdout: string | undefined, stderr: string | undefined) => {
        const status = check.parse(stdout ?? "", stderr ?? "");
        if (status) {
          resolve(withWarning(backend, status));
          return;
        }
        const detail = clean(stderr ?? "").trim() || (err ? message(err) : "") || "No status in the CLI's output.";
        resolve({ loggedIn: false, error: detail.slice(0, 500) });
      },
    );
  });
}
