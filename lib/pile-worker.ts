// The commit walk-through for a worker project (docs/architecture/project-hosts.md, T5). On this Mac the prompt is
// written from this Mac's store: each Review card's files, and the commit script on this disk (lib/commit-pile.ts). A
// worker's card can read its own tree, so its prompt starts from the worker's snapshot (the pile badge's counts) and
// has the card map the files to the work itself, committing by path with plain git, which every checkout has.
import type { PileSummary } from "./project-reads";

export function workerPilePrompt(pile: PileSummary): { prompt: string; title: string } {
  const prompt = [
    `Walk me through committing the uncommitted work in ${pile.root}: ${pile.files} files, +${pile.added}/-${pile.removed} lines${pile.cards ? `, from ${pile.cards} cards in Review` : ""}. Several cards' changes may be mixed in this working tree. Commit them one piece of work at a time, each with only its own files.`,
    "",
    "Safety, no exceptions: never `git stash`, `git reset`, `git checkout -- <file>`, `git restore`, `git add -A`, `git add .` or a bare `git commit`. Other threads may be editing this tree right now. Commit only by path:",
    '  git add -- <file> <file> … && git commit -m "<type(scope): message>" -- <file> <file> …',
    "Use conventional commit messages.",
    "",
    "Start with `git status --short` and `git diff --stat`, group the files by the work they belong to, show me the groups, and ask before each commit. Leave alone any file you can't place.",
  ].join("\n");
  return { prompt, title: `Commit the uncommitted pile in ${pile.root}` };
}
