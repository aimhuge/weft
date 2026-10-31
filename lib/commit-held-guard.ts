import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { holdBack } from "./commit-held";
import { repoRoot } from "./dirty-files";
import { getCard, listCards } from "./store";

// The guard side of lib/commit-held.ts: it knows which card is running, so it leaves the notes commit.sh reads.
// Only a line that runs commit.sh pays for this, and it answers nothing: the call goes on either way.

const run = promisify(execFile);
const COMMIT_SCRIPT = /\bcommit\.sh\b/;

// The changed files this command line names, repo-relative.
export async function namedPaths(root: string, command: string) {
  const { stdout } = await run("git", ["-C", root, "diff", "--name-only", "HEAD"], { maxBuffer: 8 << 20 });
  const words = new Set(command.split(/[\s"']+/));
  return stdout.split("\n").filter((p) => p && words.has(p));
}

export function commitHeldGuard(cardId: () => string | undefined): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const command = (input.tool_input as { command?: unknown } | null)?.command;
    if (typeof command !== "string" || !COMMIT_SCRIPT.test(command)) return {};
    const card = getCard(cardId() ?? "");
    const root = card && repoRoot(input.cwd);
    if (!card || !root) return {};
    await holdBack(root, await namedPaths(root, command).catch(() => []), card, listCards());
    return {};
  };
}

export function commitHeldHook(cardId: () => string | undefined): HookCallbackMatcher {
  return { matcher: "Bash", hooks: [commitHeldGuard(cardId)] };
}
