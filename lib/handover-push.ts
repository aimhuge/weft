// Handing a card over (lib/handover.ts), on the owner's Mac: the card's work goes up as one branch the teammate can
// fetch. Only the files the card's own edits touched go in, on top of HEAD (with any commits not pushed yet), through a
// throwaway index: the working tree, the real index and the checked-out branch stay exactly as they were, so the other
// cards working in this tree don't notice. A card with nothing changed pushes HEAD itself.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<string>;

export interface Pushed {
  branch: string;
  sha: string;
  // The files that went into the commit, repo-relative.
  files: string[];
}

// No prompt for a password with no terminal to type it in; a push that would wait on one fails instead.
const gitEnv = (env: NodeJS.ProcessEnv = process.env) => ({ ...env, GIT_TERMINAL_PROMPT: "0" });

export const defaultGit: Git = (cwd, args, env) =>
  new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env: gitEnv(env), timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });

// The branch a card's handover goes to: Weft's own, one per card, so asking again replaces it.
export const handoverBranch = (cardId: string) => `weft/handover/${cardId.slice(0, 8)}`;

// Absolute paths → repo-relative, dropping any outside the repo. `roots` are the repo's top as git spells it and as the
// card does (/var vs /private/var on macOS, a symlinked checkout): a file under either counts.
export function inRepo(roots: string[], files: string[]): string[] {
  const relTo = (file: string) => {
    for (const root of roots) {
      const rel = path.relative(root, path.resolve(root, file));
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return [rel];
    }
    return [];
  };
  return [...new Set(files.flatMap(relTo))];
}

// Of these paths, the ones git sees as changed or new (not ignored): `git add` refuses an ignored path outright.
async function changed(git: Git, root: string, files: string[]): Promise<string[]> {
  if (!files.length) return [];
  const out = await git(root, ["status", "--porcelain", "-z", "--untracked-files=all", "--", ...files]);
  const paths: string[] = [];
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    paths.push(entry.slice(3));
    // A rename's entry is followed by its old path, which isn't one to add.
    if (entry[0] === "R" || entry[0] === "C") i++;
  }
  return paths;
}

export async function pushCardWork(cwd: string, files: string[], branch: string, message: string, git: Git = defaultGit): Promise<Pushed> {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  const cdup = (await git(cwd, ["rev-parse", "--show-cdup"])).trim();
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  const picked = await changed(git, root, inRepo([root, path.resolve(cwd, cdup)], files));
  let sha = head;
  if (picked.length) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "weft-handover-"));
    const env = { ...process.env, GIT_INDEX_FILE: path.join(dir, "index") };
    try {
      await git(root, ["read-tree", "HEAD"], env);
      await git(root, ["add", "-A", "--", ...picked], env);
      const tree = (await git(root, ["write-tree"], env)).trim();
      sha = (await git(root, ["commit-tree", tree, "-p", head, "-m", message])).trim();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  await git(root, ["push", "--force", "origin", `${sha}:refs/heads/${branch}`]);
  return { branch, sha, files: picked };
}
