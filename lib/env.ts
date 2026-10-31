import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { guardHooks } from "./guards/hooks";
import { findSecret } from "./secret-detect";

// The environment for the CLIs Weft starts. When Weft itself was started from inside a Claude Code
// session (the Claude app's terminal, say), it inherits that session's variables — its session id,
// messaging socket, entrypoint — and its CLIs would act as that session's children. Strip them, and
// mark Weft's sessions as SDK sessions so they stay out of other apps' session lists.
const INHERITED = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/;
// Weft's own keys, which the server needs and its CLIs mustn't see: the browser pane's control-server
// token (any thread holding it could drive the pane without Weft's tools). Every CLI gets this env, so
// nothing secret may live in the server's environment unless it's stripped here
// (docs/architecture/secrets.md).
const INTERNAL = /^WEFT_SHELL_/;
// What Weft's own `next dev` sets in its process, and the NEXT_PUBLIC_ values it loads from Weft's .env:
// a thread's shell should look like your terminal. NODE_ENV=development breaks `next build` in any other
// project (its prerender fails), and PORT would point a thread's dev server at Weft's own port. Your own
// Next settings, like NEXT_TELEMETRY_DISABLED, stay.
const NEXT_SERVER = /^(NODE_ENV|PORT|NEXT_RUNTIME|NEXT_DEPLOYMENT_ID)$|^(__NEXT_|NEXT_PRIVATE_|NEXT_PUBLIC_|NEXT_CPU_PROF|NEXT_TURBOPACK_|TURBOPACK|WATCHPACK_)/;
// Your own secrets: Weft starts from your login shell's env, so a key exported in ~/.zshrc would reach
// every thread, where `node -e` can print it past the guard. A name that sounds secret goes, and so does
// any value that looks like a key (lib/secret-detect.ts), except what the CLIs sign in with. A command
// that needs one gets it from the vault through mcp__secrets__run.
const SECRET_NAME = /(^|_)(KEYS?|TOKENS?|SECRETS?|PASSWORD|PASSWD|PASSPHRASE|CREDENTIALS?|PRIVATE|PAT|DSN)(_|$)|(^|_)DATABASE_URL$/i;
const CLI_SIGN_IN = /^(ANTHROPIC_|PUKU_)|^CODEX_API_KEY$/;
// Claude Code's headless sign-in (`claude setup-token`): how a Weft Worker's CLIs log in, where no keychain prompt
// can be answered (docs/architecture/weft-worker.md). Kept unless Weft runs inside a Claude session, whose own
// token it would be.
const CLAUDE_OAUTH = "CLAUDE_CODE_OAUTH_TOKEN";
// Loader hooks: variables that make a process load code before it runs its own. NODE_OPTIONS
// (--require, --import) reaches every Node a thread starts; LD_PRELOAD and the DYLD_* family reach
// every process at the native level. A value here is never a secret by shape, but it is a way to run
// code in a thread's process — so it goes by name, whatever it holds (2026-10-28).
// NODE_EXTRA_CA_CERTS stays: it names a certificate, it doesn't run anything.
const LOADER = /^(NODE_OPTIONS|LD_PRELOAD|LD_AUDIT|LD_LIBRARY_PATH|DYLD_INSERT_LIBRARIES|DYLD_LIBRARY_PATH|DYLD_FRAMEWORK_PATH)$/;

function isSecretVar(key: string, value: string | undefined): boolean {
  if (CLI_SIGN_IN.test(key)) return false;
  if (LOADER.test(key)) return true;
  return SECRET_NAME.test(key) || (value !== undefined && findSecret(value) !== null);
}

export function cliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const insideClaude = Boolean(env.CLAUDECODE || env.CLAUDE_CODE_DESKTOP_APP_VERSION);
  for (const [key, value] of Object.entries(env)) {
    if (key === CLAUDE_OAUTH && !insideClaude) continue;
    if (INHERITED.test(key) || INTERNAL.test(key) || NEXT_SERVER.test(key) || isSecretVar(key, value)) Reflect.deleteProperty(env, key);
  }
  // The Claude app routes its own sessions through a local proxy; that address isn't ours to use.
  if (insideClaude) delete env.ANTHROPIC_BASE_URL;
  env.CLAUDE_CODE_ENTRYPOINT = "sdk-ts";
  // So .claude/settings.json's hook can tell this server's own CLIs from ones a thread starts (lib/weft-thread.ts).
  env.WEFT_SERVER_PID = String(process.pid);
  // A thread left alone for 5 minutes loses its prompt cache and re-sends everything at full price; an hour keeps it
  // warm across a coffee. Subscriptions already get this; API keys don't (1-hour writes cost more).
  env.CLAUDE_CODE_PROMPT_CACHE_TTL = "1h";
  return env;
}

// The thread prompt's line that goes with the restart guard (lib/restart-guard.ts).
export { RESTART_PROMPT } from "./restart-guard";

// What a Claude Code or puku-cli board thread is started with: that env and Weft's guard set as the Agent SDK's
// in-process hooks (lib/guards/hooks.ts, where each guard is named). Codex and Goose run the same set through
// their own hooks (lib/guards/codex.ts, lib/guards/goose.ts).
export function guardedCli(otherTurns: () => number, cardId: () => string | undefined): Pick<Options, "env" | "hooks"> {
  return { env: cliEnv(), hooks: guardHooks(otherTurns, cardId) };
}
