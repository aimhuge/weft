import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { draftsOf, stampCard } from "./changelog";
import { commitFiles, commitsSince, head } from "./changelog-git";
import { writeChangelog, writeNote } from "./changelog-write";
import { projectRoot } from "./quality-files";
import { getCard } from "./store";

// The git half of the changelog (lib/changelog.ts): when a thread's own Bash call commits (`git commit`, or /weft:done's
// commit.sh), the card's draft entries in that project that the commit carries (it touched one of their files,
// lib/changelog-files.ts) get its sha, and Weft writes and commits CHANGELOG.md
// right after (lib/changelog-write.ts). HEAD is read before and after the call,
// so a commit that a hook refused, or a line that only mentions committing, stamps nothing. The commit walk-through's
// buttons commit without a turn and stamp through stampAfterCommit (lib/pile-commit.ts).

const COMMITS = /\bgit\b[^\n|;&]*\bcommit\b|\bcommit\.sh\b/;

// HEAD before each committing call, by tool use id; calls that never finish fall past the cap.
const CAP = 100;
const before = new Map<string, string>();

export { head };

// A commit landed for a card in the repo at `cwd`: stamp its drafts there that the commit touched. The number stamped,
// 0 when there's no card.
export function stampAfterCommit(cardId: string | undefined, cwd: string, sha: string | null): number {
  if (!cardId || !sha) return 0;
  const root = projectRoot(cwd);
  return stampCard(cardId, root, sha, commitFiles(root, sha));
}

// What the thread is told after its call landed commits: what got stamped, and the drafts none of them carried, so a
// card whose commit did carry one (its files named wrong) can stamp it by hand.
export function stampNote(cardId: string | undefined, cwd: string, was: string, now: string): string {
  const shas = commitsSince(projectRoot(cwd), was, now);
  const counts = shas.map((sha) => [sha.slice(0, 7), stampAfterCommit(cardId, cwd, sha)] as const).filter(([, k]) => k);
  const n = counts.reduce((sum, [, k]) => sum + k, 0);
  const left = cardId ? draftsOf(cardId, projectRoot(cwd)) : [];
  const stamped = n ? `Weft stamped ${n} changelog entr${n === 1 ? "y" : "ies"} of this card with ${counts.map(([s]) => s).join(", ")} (now committed).` : "";
  const drafts = left.length
    ? `${left.length} draft entr${left.length === 1 ? "y" : "ies"} of this card stayed draft: the commit touched none of ${left.length === 1 ? "its" : "their"} files (${left.map((e) => e.id).join(", ")}). If one belongs to this commit, call mcp__board__changelog_edit with its id and sha ${now.slice(0, 7)}, or with files.`
    : "";
  return [stamped, drafts].filter(Boolean).join(" ");
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
    const stamped = stampNote(cardId(), cwd, was, now);
    // Before the thread's next call (a push, a tag), so they carry it.
    const written = writeNote(await writeChangelog(root, getCard(cardId() ?? "")?.title ?? now.slice(0, 7)));
    const note = [stamped, written].filter(Boolean).join(" ");
    return note ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } } : {};
  };
  return { pre: { matcher: "Bash", hooks: [pre] }, post: { matcher: "Bash", hooks: [post] } };
}
