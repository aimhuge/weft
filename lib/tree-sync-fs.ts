// A synced folder's checkout as the engine sees it (docs/architecture/folder-sync.md): each path's state against HEAD,
// its bytes, and writes that land whole (a temp file renamed over the old) or not at all.
//
// What never syncs: anything .gitignore hides (node_modules, build output), .git itself, secret files (.env and the
// like, not their .example templates: each machine keeps its own values in its vault), symlinks, and files over
// MAX_FILE. A change coming in for one of those is refused, so the other end can't write there either.
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultGit, type Git } from "./handover-push";
import { SECRET_FILE, TEMPLATE } from "./secret-guard-files";
import { MAX_FILE, safePath, type FileState, type Files } from "./tree-sync-protocol";

const HEAD = "HEAD";

// The git blob id of these bytes, as `git hash-object` gives it for a file with no filters.
export const blobSha = (data: Buffer) =>
  createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");

const isSecret = (p: string) => {
  const name = path.posix.basename(p);
  return SECRET_FILE.test(name) && !TEMPLATE.test(name);
};

// Bytes from git, for a file HEAD holds (`git show` would turn them into a string).
const gitBytes = (root: string, args: string[]) =>
  new Promise<Buffer>((resolve, reject) => {
    execFile("git", args, { cwd: root, encoding: "buffer", maxBuffer: MAX_FILE + 1024 }, (err, stdout) => {
      if (err) reject(new Error(err.message));
      else resolve(stdout);
    });
  });

const literal = (p: string) => `:(literal)${p}`;

export function treeFs(root: string, git: Git = defaultGit) {
  const abs = (p: string) => path.join(root, ...p.split("/"));

  // HEAD's blob for each path it holds.
  async function headBlobs(paths: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!paths.length) return out;
    const listed = await git(root, ["ls-tree", "-z", "HEAD", "--", ...paths.map(literal)]).catch(() => "");
    for (const entry of listed.split("\0")) {
      const m = /^\d+ blob ([0-9a-f]+)\t([^]+)$/.exec(entry);
      if (m) out.set(m[2] as string, m[1] as string);
    }
    return out;
  }

  async function ignored(paths: string[]): Promise<Set<string>> {
    if (!paths.length) return new Set();
    // Exit 1 means none of them is ignored: no output either way.
    const listed = await new Promise<string>((resolve) => {
      const child = execFile("git", ["check-ignore", "-z", "--stdin"], { cwd: root }, (_err, stdout) => resolve(stdout));
      child.stdin?.end(paths.join("\0") + "\0");
    });
    return new Set(listed.split("\0").filter(Boolean));
  }

  // Whether a path syncs at all, the content aside.
  const syncs = (p: string) => safePath(p) && !isSecret(p);

  // What's on disk for each path, folded to HEAD where it matches. A path that can't sync is left out.
  async function states(paths: string[]): Promise<Files> {
    const wanted = paths.filter(syncs);
    const [heads, hidden] = await Promise.all([headBlobs(wanted), ignored(wanted)]);
    const out: Files = {};
    for (const p of wanted) {
      if (hidden.has(p) && !heads.has(p)) continue;
      const stat = await fs.lstat(abs(p)).catch(() => null);
      let state: FileState;
      if (!stat) state = heads.has(p) ? null : HEAD;
      else if (!stat.isFile() || stat.size > MAX_FILE) continue;
      else {
        const sha = blobSha(await fs.readFile(abs(p)));
        state = heads.get(p) === sha ? HEAD : sha;
      }
      out[p] = state;
    }
    return out;
  }

  return {
    root,
    async where(): Promise<{ branch: string; head: string }> {
      const branch = (await git(root, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")).trim();
      const head = (await git(root, ["rev-parse", "HEAD"])).trim();
      return { branch, head };
    },

    // Every path not at HEAD: what a hello carries.
    async changed(): Promise<Files> {
      const out = await git(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
      const paths = out
        .split("\0")
        .filter((e) => e.length > 3)
        .map((e) => e.slice(3));
      const all = await states(paths);
      return Object.fromEntries(Object.entries(all).filter(([, s]) => s !== HEAD));
    },

    async state(p: string): Promise<FileState | undefined> {
      return (await states([p]))[p];
    },

    syncs,

    read: (p: string) => fs.readFile(abs(p)),

    // Puts a path in `state`: bytes for a sha (checked against it), gone for null, HEAD's for "HEAD".
    async write(p: string, state: FileState, data?: Buffer): Promise<void> {
      if (!syncs(p)) throw new Error(`${p} doesn't sync.`);
      const file = abs(p);
      await insideRoot(root, path.dirname(file));
      if (state === null) {
        await fs.rm(file, { force: true });
        return;
      }
      if (state === HEAD) {
        const held = (await headBlobs([p])).has(p);
        if (!held) {
          await fs.rm(file, { force: true });
          return;
        }
        data = await gitBytes(root, ["cat-file", "blob", `HEAD:${p}`]);
      } else if (!data || blobSha(data) !== state) throw new Error(`${p} arrived damaged.`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = path.join(path.dirname(file), `.weft-sync-${randomBytes(6).toString("hex")}`);
      const mode = await fs.stat(file).then((s) => s.mode, () => undefined);
      await fs.writeFile(tmp, data, mode === undefined ? undefined : { mode });
      await fs.rename(tmp, file).catch(async (err: unknown) => {
        await fs.rm(tmp, { force: true });
        throw err;
      });
    },

    // Keeps this end's file beside it before the other end's version lands: a.ts → a.conflict-<label>.ts.
    async copyAside(p: string, label: string): Promise<string> {
      const ext = path.posix.extname(p);
      const stem = p.slice(0, p.length - ext.length);
      const tag = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
      for (let n = 1; ; n++) {
        const copy = `${stem}.conflict-${tag}${n > 1 ? `-${n}` : ""}${ext}`;
        if (await fs.lstat(abs(copy)).catch(() => null)) continue;
        await fs.copyFile(abs(p), abs(copy));
        return copy;
      }
    },
  };
}

// A write never goes through a symlinked folder to somewhere outside the checkout: the nearest folder on the way that
// exists already must resolve inside it.
async function insideRoot(root: string, dir: string): Promise<void> {
  let real: string | null = null;
  for (let at = dir; !real; at = path.dirname(at)) {
    real = await fs.realpath(at).catch(() => null);
    if (at === path.dirname(at)) break;
  }
  if (!real) return;
  const top = await fs.realpath(root);
  if (real !== top && !real.startsWith(top + path.sep)) throw new Error("That path leaves the project.");
}

export type TreeFs = ReturnType<typeof treeFs>;
