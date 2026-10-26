// A branch name typed for an isolated card's worktree (docs/architecture/worktrees.md), checked on both sides: the New
// thread dialog's branch picker offers "Create branch" only for one that passes, and the server keeps only one that
// passes. Git's own rules (`git check-ref-format --branch`), the ones a name typed by hand can break; git still has
// the last word when the card takes its worktree.

export const MAX_BRANCH = 100;

export function validBranch(name: string): boolean {
  if (!name || name.length > MAX_BRANCH) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return false;
  if (name === "HEAD" || name.startsWith("-") || name.endsWith(".lock") || name.endsWith(".")) return false;
  if (name.includes("..") || name.includes("//")) return false;
  return name.split("/").every((part) => part !== "" && !part.startsWith("."));
}
