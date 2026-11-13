// A project's uncommitted work as one git commit, so another of your Macs can pick it up
// (docs/architecture/wip-sync.md). The snapshot is everything `git add -A` would take (the index, the working tree and
// the untracked files .gitignore doesn't hide), committed on top of HEAD through a throwaway index and kept on a hidden
// ref, refs/weft/wip/<the machine's id>. Building one changes nothing a thread can see: the working tree, the real
// index and the checked-out branch stay exactly as they were. Pushing it sends that one ref to the project's own remote:
// no branch moves, so no CI run and no deploy.
//
// Secrets never ride along. A .env the project forgot to ignore stays as HEAD has it (absent, usually): each Mac keeps
// its own values in its vault.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultGit, type Git } from "./handover-push";
import { SECRET_FILE, TEMPLATE } from "./secret-guard-files";

export const WIP_REMOTE = "origin";
// A Mac's device id (64 hex) or a Weft Worker's id (a uuid): nothing that could name another ref.
const DEVICE = /^[0-9a-f][0-9a-f-]{7,63}$/;
const FIELD = "\x1f";

// The hidden ref one Mac's snapshot lives on, here and on the remote.
export function wipRef(device: string): string {
  if (!DEVICE.test(device)) throw new Error("That isn't one of your machines.");
  return `refs/weft/wip/${device}`;
}

// What a snapshot says about itself, in its commit message: the Mac that made it and the branch it was on.
export interface WipMeta {
  mac: string;
  branch: string;
}

export interface Snapshot extends WipMeta {
  sha: string;
  // The commit it sits on: the sending Mac's HEAD.
  head: string;
  // When it was made, in ms.
  at: number;
  // How many files differ from that HEAD.
  files: number;
}

const one = async (git: Git, root: string, args: string[], env?: NodeJS.ProcessEnv) => (await git(root, args, env)).trim();
const lines = (out: string) => out.split("\n").filter(Boolean);

// Whether git has this object or ref; never throws.
const has = (git: Git, root: string, rev: string) => one(git, root, ["rev-parse", "-q", "--verify", rev]).catch(() => "");

const isSecret = (file: string) => {
  const name = path.basename(file);
  return SECRET_FILE.test(name) && !TEMPLATE.test(name);
};

// The branch checked out, or a refusal: a detached HEAD has no branch for the other Mac to be on.
export async function branchOf(root: string, git: Git = defaultGit): Promise<string> {
  const branch = await one(git, root, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "");
  if (!branch) throw new Error("This project isn't on a branch (detached HEAD), so its work can't move between Macs.");
  return branch;
}

// The working tree as a git tree, through a copy of the index (which keeps git's stat cache, so only changed files are
// hashed). Secret files are put back to what HEAD holds.
export async function worktreeTree(root: string, git: Git = defaultGit): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "weft-wip-"));
  const index = path.join(dir, "index");
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const real = path.resolve(root, await one(git, root, ["rev-parse", "--git-path", "index"]));
    if (existsSync(real)) copyFileSync(real, index);
    await git(root, ["add", "-A"], env);
    const secrets = (await git(root, ["ls-files", "-z"], env)).split("\0").filter(isSecret);
    if (secrets.length) await git(root, ["restore", "--staged", "--source=HEAD", "--", ...secrets.map((file) => `:(literal)${file}`)], env);
    return await one(git, root, ["write-tree"], env);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Weft's own name on the commit, so a Mac with no git identity set can still make one.
const AUTHOR = { GIT_AUTHOR_NAME: "Weft", GIT_AUTHOR_EMAIL: "wip@weft.zip", GIT_COMMITTER_NAME: "Weft", GIT_COMMITTER_EMAIL: "wip@weft.zip" };

// Reads a snapshot commit back. Null when it isn't one of Weft's (no meta in its message).
export async function readSnapshot(root: string, rev: string, git: Git = defaultGit): Promise<Snapshot | null> {
  const [sha = "", at = "", head = "", body = ""] = (await git(root, ["show", "-s", `--format=%H${FIELD}%ct${FIELD}%P${FIELD}%b`, rev])).split(FIELD);
  let meta: Partial<WipMeta>;
  try {
    meta = JSON.parse(body) as Partial<WipMeta>;
  } catch {
    return null;
  }
  if (typeof meta.mac !== "string" || typeof meta.branch !== "string" || !/^[0-9a-f]{40,64}$/.test(head)) return null;
  const files = lines(await git(root, ["diff", "--name-only", head, sha])).length;
  return { sha, head, at: Number(at) * 1000, mac: meta.mac, branch: meta.branch, files };
}

// Builds this Mac's snapshot and points its hidden ref at it.
export async function snapshotWip(root: string, self: { device: string; mac: string }, git: Git = defaultGit): Promise<Snapshot> {
  const ref = wipRef(self.device);
  const branch = await branchOf(root, git);
  const head = await one(git, root, ["rev-parse", "HEAD"]);
  const tree = await worktreeTree(root, git);
  const meta: WipMeta = { mac: self.mac, branch };
  const message = `wip: ${branch} on ${self.mac}\n\n${JSON.stringify(meta)}`;
  const sha = await one(git, root, ["commit-tree", tree, "-p", head, "-m", message], { ...process.env, ...AUTHOR });
  await git(root, ["update-ref", ref, sha]);
  return (await readSnapshot(root, sha, git)) as Snapshot;
}

// Sends this Mac's snapshot ref to the remote. No hooks: a pre-push test run has nothing to say about a hidden ref.
export async function pushWip(root: string, device: string, git: Git = defaultGit): Promise<void> {
  const ref = wipRef(device);
  await git(root, ["push", "--no-verify", "--force", WIP_REMOTE, `${ref}:${ref}`]);
}

// Brings another Mac's snapshot ref down. Null when that Mac has never sent one for this project.
export async function fetchWip(root: string, device: string, git: Git = defaultGit): Promise<Snapshot | null> {
  const ref = wipRef(device);
  const listed = await one(git, root, ["ls-remote", WIP_REMOTE, ref]);
  if (!listed) return null;
  await git(root, ["fetch", "--no-tags", WIP_REMOTE, `+${ref}:${ref}`]);
  return readSnapshot(root, ref, git);
}

const LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"]);

export interface Applied extends Snapshot {
  // A lockfile changed on the way in: the dependencies need installing.
  install: boolean;
  // The files this Mac's working tree gained, lost or had rewritten.
  changed: number;
}

// Makes this Mac's working tree the snapshot's: the branch fast-forwarded to the commit the snapshot sits on, the
// snapshot's changes on top as uncommitted work (new files untracked, as they were on the Mac that sent them).
//
// It refuses rather than lose anything. This Mac must be on the same branch, with no commits the other lacks, and its
// own uncommitted work must be either none or exactly what it last sent (refs/weft/wip/<self>, which the other Mac
// built on): that is the "one owner at a time" rule, checked at the moment the work moves.
export async function applyWip(root: string, from: string, self: string, git: Git = defaultGit): Promise<Applied> {
  const snap = await readSnapshot(root, wipRef(from), git);
  if (!snap) throw new Error("That Mac's work isn't a snapshot Weft made.");
  const branch = await branchOf(root, git);
  if (branch !== snap.branch) throw new Error(`${snap.mac}'s work is on ${snap.branch} and this Mac is on ${branch}. Switch to ${snap.branch} here first.`);
  const ahead = await git(root, ["merge-base", "--is-ancestor", "HEAD", snap.head]).then(
    () => false,
    () => true,
  );
  if (ahead) throw new Error(`This Mac has commits on ${branch} that ${snap.mac} doesn't. Push them and pull there first.`);
  const now = await worktreeTree(root, git);
  const clean = await one(git, root, ["rev-parse", "HEAD^{tree}"]);
  const sent = await has(git, root, `${wipRef(self)}^{tree}`);
  if (now !== clean && now !== sent) throw new Error(`This Mac has uncommitted work of its own in ${branch}. Commit it, or send it to ${snap.mac} first.`);
  const changed = lines(await git(root, ["diff", "--name-only", now, snap.sha]));
  // The index stands for the working tree as it is (secret files aside), so the checkout removes what the snapshot dropped.
  await git(root, ["read-tree", now]);
  await git(root, ["read-tree", "--reset", "-u", snap.sha]);
  // The branch moves to the snapshot's base, and the index with it; the working tree keeps the snapshot.
  await git(root, ["reset", "-q", snap.head]);
  return { ...snap, changed: changed.length, install: changed.some((file) => LOCKFILES.has(path.basename(file))) };
}
