import { hookCommand } from "./answer";
import type { GuardEvent } from "./decide";
import { GUARD_TOKEN_ENV, GUARD_URL_ENV } from "./turn";

// Weft's guards on a Codex turn (docs/architecture/thread-guards.md). Codex 0.162 has Claude Code's hooks: a
// PreToolUse hook sees every call (its shell as Bash, its edits as apply_patch, MCP tools by name) before it runs
// and can deny it, in every sandbox and approval mode. Weft gives each turn its hooks on the command line, so
// nothing is written to ~/.codex:
//
//   --enable hooks                     on, even if your config.toml turned the feature off
//   --dangerously-bypass-hook-trust    Codex asks you to trust a new hook in its TUI; `codex exec` has no TUI, and
//                                      Weft wrote this hook itself. Codex reports the flag as an error item, which
//                                      the runner doesn't show (lib/codex-runner.ts handles only its own items).
//   hooks.<event>                      the inline command (lib/guards/answer.ts) that posts the call to Weft
//   shell_environment_policy.exclude   the turn's tokens stay out of the model's shell; the hooks still get them
const EVENTS: GuardEvent[] = ["PreToolUse", "PostToolUse"];

// An ask can wait on you (lib/guards/ask.ts), so the hook may take as long as curl allows it.
const HOOK_TIMEOUT = 3600;

// TOML's basic strings take JSON's escapes, so JSON.stringify writes them.
function hookConfig(event: GuardEvent): string {
  return `hooks.${event}=[{matcher="*",hooks=[{type="command",command=${JSON.stringify(hookCommand("codex", event))},timeout=${HOOK_TIMEOUT}}]}]`;
}

/** The `codex exec` args that put the turn's tool calls through Weft's guards. */
export function codexGuardArgs(): string[] {
  const hidden = JSON.stringify([GUARD_TOKEN_ENV, GUARD_URL_ENV, "WEFT_MCP_TOKEN"]);
  return [
    "--enable", "hooks",
    "--dangerously-bypass-hook-trust",
    ...EVENTS.flatMap((event) => ["--config", hookConfig(event)]),
    "--config", `shell_environment_policy.exclude=${hidden}`,
  ];
}
