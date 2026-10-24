import { pushOnDone } from "./settings";
import { getCard, updateCard } from "./store";
import { landWorktree, type Landed } from "./worktree-land";
import { returnWorktree } from "./worktree-pool";

// An isolated card's Done (docs/architecture/worktrees.md): its /weft:done turn ran in the worktree and committed
// there; when that wrap-up ends (lib/runner-turn.ts settleWrapUp), this lands the branch on the main tree and files
// the card away, or hands it back. A rebase conflict or a failed commit goes to the thread to fix; uncommitted
// changes in the main tree (another card's work) leave the card in Review with the files named.

const log = (line: string) => console.log(`[worktrees] ${line}`);

// What the thread is told when its branch couldn't land.
export function landNote(branch: string, r: Extract<Landed, { ok: false }>): string {
  if (r.kind === "conflict") {
    const files = r.files.length ? ` in ${r.files.join(", ")}` : "";
    return `Weft couldn't land ${branch}: rebasing it on the project's branch conflicts${files}. In your worktree, run \`git rebase ${r.onto ?? "main"}\`, resolve the conflicts, \`git add\` them and \`git rebase --continue\`, then run the tests again. Weft lands it when the card moves to Done again.`;
  }
  return `Weft couldn't land ${branch}: ${r.message} Fix what it names in your worktree and commit; Weft lands it when the card moves to Done again.`;
}

export async function landCard(cardId: string, send: (cardId: string, text: string) => void): Promise<void> {
  const card = getCard(cardId);
  if (!card?.worktree) return;
  const wt = card.worktree;
  updateCard(cardId, { wrappingUp: true, lastLine: "Landing its branch…" });
  let r: Landed;
  try {
    r = await landWorktree(wt, card.title, { push: pushOnDone() });
  } catch (err) {
    r = { ok: false, kind: "error", files: [], message: err instanceof Error ? err.message : String(err) };
  }
  if (r.ok) {
    await returnWorktree(wt).catch((err: unknown) => log(`couldn't return ${wt.path}: ${String(err)}`));
    // Still isolated: a reply after this takes a fresh worktree, from a HEAD that now holds this card's work.
    const line = r.nothing ? "Nothing to land" : `Landed on ${r.onto} (${r.commit})${r.pushed ? ", pushed" : ""}`;
    updateCard(cardId, { worktree: undefined, claims: undefined, column: "done", archived: !getCard(cardId)?.starred, wrappingUp: false, lastLine: line });
    return;
  }
  updateCard(cardId, { wrappingUp: false, archived: false });
  if (r.kind === "conflict" || r.kind === "commit") {
    try {
      send(cardId, landNote(wt.branch, r));
      return;
    } catch {}
  }
  updateCard(cardId, { column: "review", lastLine: "Couldn't land its branch", error: landNote(wt.branch, r) });
}
