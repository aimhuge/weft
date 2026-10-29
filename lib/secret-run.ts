import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text } from "./browser-tools";
import { cardProof } from "./card-token";
import { asText } from "./format";
import { globalSingleton } from "./global-singleton";
import { addMissingBlank, missingText } from "./secret-ask";
import { checkCommand, checkNames, packageScript, resolveCwd } from "./secret-command";
import { shellToken } from "./shell-token";

// Vault values in a command's env, for a thread that never sees them (docs/architecture/secrets.md). This side
// checks the command and splits it; Electron main asks the user (the exact command, its package.json script,
// the names), spawns it with no shell and the values in its env only, and hands back output with every value
// swapped for ‹NAME›. Values never pass through this server.

export const RUN_PROMPT = `To run a command that needs vault secrets (a migration or job that needs DATABASE_URL, a CLI that needs an API token), call mcp__secrets__run with the command and the secret names: Weft asks the user with Touch ID, runs it with those values in its env, and returns the output with each value shown as ‹NAME›. The command runs as one program with no shell (no pipes, redirects, && or $VAR); put multi-step work in a package.json script. Your own Bash never gets the values.`;

const ENVIRONMENTS = ["development", "preview", "production"] as const;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;

// Cards whose thread has had vault values put to work this run of Weft: their tool results go through main's
// redaction before they're stored (redactStored).
const inUse = globalSingleton("__weftSecretsInUse", () => new Set<string>());

export function markInUse(cardId: string | undefined) {
  if (cardId) inUse.add(cardId);
}

export function usesSecrets(cardId: string): boolean {
  return inUse.has(cardId);
}

/**
 * Text from a card's thread with the values it used swapped for ‹NAME›, before it's written to ~/.weft/threads
 * and the search index. Only cards that used secrets ask main; if main can't answer, the text is held back.
 */
export async function redactStored(cardId: string, value: string): Promise<string> {
  if (!value || !inUse.has(cardId)) return value;
  try {
    return asText((await shell("/secrets/redact", { ...cardProof(cardId, "/secrets/redact"), text: value })).text);
  } catch {
    return "‹output hidden: Weft couldn't check it for vault secrets›";
  }
}

/** Hands store the texts as they are, or once main has redacted them for a card that used secrets. */
export function withRedacted(cardId: string, texts: string[], store: (texts: string[]) => void): void | Promise<void> {
  if (!inUse.has(cardId)) {
    store(texts);
    return;
  }
  return Promise.all(texts.map((t) => redactStored(cardId, t))).then(store);
}

type RunReply = {
  denied?: boolean;
  missing?: string[];
  label?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  output?: string;
  truncated?: boolean;
  ms?: number;
};

function describeRun(command: string, r: RunReply): { said: string; failed: boolean } {
  const vault = asText(r.label, "this");
  if (r.denied) return { said: `The user didn't approve running ${command} with secrets. Ask before trying again.`, failed: true };
  const how = r.timedOut ? "timed out and was stopped" : r.signal ? `was killed by ${r.signal}` : `exited with code ${r.exitCode}`;
  const secs = `${((r.ms ?? 0) / 1000).toFixed(1)}s`;
  const output = r.output?.trim() ? `${r.truncated ? "(earlier output cut)\n" : ""}${r.output.trimEnd()}` : "(no output)";
  return { said: `${command} ${how} after ${secs} (secrets from the ${vault} vault shown as ‹NAME›):\n${output}`, failed: Boolean(r.timedOut || r.signal || r.exitCode !== 0) };
}

/** mcp__secrets__run. folder is the card's project and title its name for the approval, read when the tool runs. */
export function runTool(cardId: () => string | undefined, folder: () => string, title: () => string | undefined = () => undefined) {
  return tool(
    "run",
    "Run one command with secrets from the 🔐 vault in its environment, e.g. `npm run migrate` with DATABASE_URL. The user approves the exact command and names with Touch ID. Runs as one program with no shell (no pipes, redirects, && or $VAR expansion). Returns the exit code and output, with each secret's value shown as ‹NAME›.",
    {
      command: z.string().describe("The command, e.g. npm run job:sync or npx prisma migrate deploy"),
      why: z.string().describe("One short sentence the user reads in the approval: why this needs these secrets, e.g. \"Send a test email to check forwarding\""),
      names: z.array(z.string()).describe("Secret names to put in its env, e.g. [\"DATABASE_URL\"]"),
      environment: z.enum(ENVIRONMENTS).optional().describe("Which values to use; defaults to development"),
      cwd: z.string().optional().describe("Folder to run in, inside the project; defaults to the project folder"),
      timeout_seconds: z.number().optional().describe(`Stop it after this long; defaults to ${DEFAULT_TIMEOUT_S}, at most ${MAX_TIMEOUT_S}`),
      project: z.string().optional().describe("Absolute path of the project whose vault to use; defaults to this thread's folder"),
    },
    ({ command, why, names, environment, cwd, timeout_seconds, project }) =>
      attempt(async () => {
        const root = project ?? folder();
        const wanted = checkNames(names);
        const { argv, env } = checkCommand(command, wanted);
        const dir = resolveCwd(root, cwd);
        const timeoutMs = Math.min(Math.max(timeout_seconds ?? DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S) * 1000;
        const key = cardId();
        const r = (await shell("/secrets/run", {
          ...cardProof(key, "/secrets/run"),
          thread: title(),
          why: asText(why).trim() || undefined,
          folder: root,
          cwd: dir,
          command: command.trim(),
          argv,
          env,
          names: wanted,
          environment: environment ?? "development",
          script: packageScript(argv, dir),
          timeoutMs,
        })) as RunReply;
        const missing = r.missing ?? [];
        if (missing.length) {
          const env = environment ?? "development";
          const added = await Promise.all(missing.map((name) => addMissingBlank(root, name, env)));
          return text(missingText(missing, env, asText(r.label, "this"), added.every(Boolean)), true);
        }
        if (!r.denied) markInUse(key);
        const { said, failed } = describeRun(command.trim(), r);
        return text(said, failed);
      }),
  );
}

export interface DevLaunch {
  bin: string;
  args: string[];
  env: Record<string, string>;
  // Read by electron/secret-env.cjs on stdin, so the token and grant never sit in a process's env.
  stdin: string;
  names: string[];
}

/**
 * How to start a card's dev server with the vault's development values: main hands out a one-time grant for
 * this command (asking the user the first time), and electron/secret-env.cjs claims it and runs the command.
 * undefined starts it the plain way, with a note for its log when there's something to say.
 */
export async function devSecrets(cardId: string, command: string, cwd: string, thread?: string): Promise<{ launch?: DevLaunch; note?: string }> {
  if (!process.env.WEFT_SHELL_URL) return {};
  let checked;
  try {
    checked = checkCommand(command);
  } catch (err) {
    return { note: `Started without vault secrets: ${(err as Error).message}` };
  }
  try {
    const r = await shell("/secrets/dev-grant", { ...cardProof(cardId, "/secrets/dev-grant"), thread, folder: cwd, cwd, command: command.trim(), argv: checked.argv, env: checked.env, script: packageScript(checked.argv, cwd) });
    const names = Array.isArray(r.names) ? (r.names as string[]) : [];
    if (r.denied) return { note: "Started without vault secrets: not approved." };
    if (!names.length || typeof r.grant !== "string") return {};
    markInUse(cardId);
    return {
      launch: {
        bin: asText(r.node),
        args: [asText(r.runner)],
        env: { ELECTRON_RUN_AS_NODE: "1" },
        stdin: JSON.stringify({ url: process.env.WEFT_SHELL_URL, token: shellToken(), grant: r.grant, argv: checked.argv, env: checked.env }),
        names,
      },
    };
  } catch (err) {
    return { note: `Started without vault secrets: ${(err as Error).message}` };
  }
}
