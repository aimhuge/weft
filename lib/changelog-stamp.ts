import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { stampCard } from "./changelog";
import { writeChangelog, writeNote } from "./changelog-write";
import { projectRoot } from "./quality-files";
import { getCard } from "./store";

// The git half of the changelog (lib/changelog.ts): when a thread's own Bash call commits (`git commit`, or /weft:done's
// commit.sh), the card's draft entries in that project get the new HEAD's sha, and Weft writes and commits CHANGELOG.md
// right after (lib/changelog-write.ts). HEAD is read before and after the call,
// so a commit that a hook refused, or a line that only mentions committing, stamps nothing. The commit walk-through's
// buttons commit without a turn and stamp through stampAfterCommit (lib/pile-commit.ts).

const COMMITS = /\bgit\b[^\n|;&]*\bcommit\b|\bcommit\.sh\b/;

// HEAD before each committing call, by tool use id; calls that never finish fall past the cap.
const CAP = 100;
const before = new Map<string, string>();

export function head(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

// A commit landed for a card in the repo at `cwd`: stamp its drafts there. The number stamped, 0 when there's no card.
export function stampAfterCommit(cardId: string | undefined, cwd: string, sha: string | null): number {
  if (!cardId || !sha) return 0;
  return stampCard(cardId, projectRoot(cwd), sha);
}

const commandOf = (input: unknown) => {
  const c = (input as { command?: unknown } | null)?.command;
  return typeof c === "string" ? c : "";
};

export function changelogStampHooks(cardId: () => string | undefined): { pre: HookCallbackMatcher; post: HookCallbackMatcher } {
  const cwdOf = () => getCard(cardId() ?? "")?.cwd;
  const pre: HookCallback = (input, toolUseId) => {
    const cwd = cwdOf();
    if (input.hook_event_name !== "PreToolUse" || !toolUseId || !cwd || !COMMITS.test(commandOf(input.tool_input))) return Promise.resolve({});
    before.set(toolUseId, head(projectRoot(cwd)) ?? "");
    if (before.size > CAP) before.delete(before.keys().next().value as string);
    return Promise.resolve({});
  };
  const post: HookCallback = async (input, toolUseId) => {
    const was = toolUseId ? before.get(toolUseId) : undefined;
    if (toolUseId) before.delete(toolUseId);
    const cwd = cwdOf();
    if (input.hook_event_name !== "PostToolUse" || was === undefined || !cwd) return {};
    const root = projectRoot(cwd);
    const now = head(root);
    if (!now || now === was) return {};
    const n = stampAfterCommit(cardId(), cwd, now);
    // Before the thread's next call (a push, a tag), so they carry it.
    const written = writeNote(await writeChangelog(root, getCard(cardId() ?? "")?.title ?? now.slice(0, 7)));
    const stamped = n ? `Weft stamped ${n} changelog entr${n === 1 ? "y" : "ies"} of this card with ${now.slice(0, 7)} (now committed).` : "";
    const note = [stamped, written].filter(Boolean).join(" ");
    return note ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } } : {};
  };
  return { pre: { matcher: "Bash", hooks: [pre] }, post: { matcher: "Bash", hooks: [post] } };
}
