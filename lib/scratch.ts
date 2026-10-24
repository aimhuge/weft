// Folders Claude Code works in that aren't projects: worktrees, the Claude app's scratch spaces, temp
// folders. Pure, so the board can ask too (lib/sync-prompt.ts); lib/welcome.ts adds the OS temp folder.
export const SCRATCH = ["/.claude/worktrees/", "/Library/Application Support/Claude/", "/tmp/", "/private/var/folders/", "-evals-results-"];

export const looksScratch = (cwd: string) => SCRATCH.some((part) => cwd.includes(part));
