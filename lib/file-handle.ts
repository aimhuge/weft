// The editor's file I/O that can't be raced out of the card's folder (lib/file-access.ts). safePath checks a path once;
// between that check and the open or the rename, a thread (or anything else with the folder) could swap a folder for a
// symlink to somewhere else. So:
//
// - a read opens with O_NOFOLLOW (the last part can't be a symlink) and then checks the file the handle holds: its path
//   from /proc/self/fd on Linux, else the realpath of the name, which must still be inside the folder and be the same
//   file (device and inode) as the handle;
// - a save writes a temp file created with O_EXCL | O_NOFOLLOW in the parent's realpath, checks that realpath again
//   immediately before the rename, and renames onto the name in that real parent (a rename never follows a symlink).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const { O_RDONLY, O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW } = fs.constants;

export function within(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// The path an open handle holds, where the system says (Linux); null elsewhere.
export async function handlePath(fd: number, readlink: (p: string) => Promise<string> = fsp.readlink): Promise<string | null> {
  try {
    return await readlink(`/proc/self/fd/${String(fd)}`);
  } catch {
    return null;
  }
}

// Opens a file inside `root` for reading. `escaped` is the error a file that left the folder throws.
export async function openInside(abs: string, root: string, escaped: () => Error): Promise<fsp.FileHandle> {
  const fh = await fsp.open(abs, O_RDONLY | O_NOFOLLOW);
  try {
    const real = (await handlePath(fh.fd)) ?? (await fsp.realpath(abs));
    if (!within(root, real)) throw escaped();
    const [held, named] = await Promise.all([fh.stat(), fsp.stat(real)]);
    if (held.dev !== named.dev || held.ino !== named.ino) throw escaped();
    return fh;
  } catch (err) {
    await fh.close();
    throw err;
  }
}

// Saves `text` at `abs` inside `root`, atomically: a reader never sees half a file.
export async function writeInside(abs: string, root: string, text: string, escaped: () => Error): Promise<string> {
  const dir = path.dirname(abs);
  await fsp.mkdir(dir, { recursive: true });
  const realDir = await fsp.realpath(dir);
  if (!within(root, realDir)) throw escaped();
  const target = path.join(realDir, path.basename(abs));
  const tmp = path.join(realDir, `.${path.basename(abs)}.${String(process.pid)}.${String(Date.now())}.tmp`);
  const fh = await fsp.open(tmp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644);
  try {
    await fh.writeFile(text, "utf8");
  } finally {
    await fh.close();
  }
  try {
    if ((await fsp.realpath(dir)) !== realDir) throw escaped();
    await fsp.rename(tmp, target);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  return target;
}
