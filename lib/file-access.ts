// The editor column's server side: read a file, stat it for live reload, get the git HEAD
// version for the diff, list files in the card's folder for ⌘P, and save a file that refuses to
// overwrite a file that changed since it was read. Every path is checked against the card's
// cwd (lib/secret-guard.ts refuses the .env family and a few others), reads are capped, and a
// binary file is refused with a clear error.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { openInside, writeInside } from "./file-handle";
import { isSecretFile } from "./secret-guard";

const execFileAsync = promisify(execFile);

// 2 MB is well above any source file the editor opens, and small enough that a confused user
// can't ask the server to read a 200 MB video into memory.
export const MAX_READ = 2 * 1024 * 1024;
// The size of the head sniff: 8 KB. A binary file shows a NUL byte in this slice almost
// every time; the read of the rest of the file never happens.
const BINARY_SNIFF = 8 * 1024;
// The upper bound on the ⌘P file list. A repo like Weft has ~10k tracked files; 20k covers a
// folder with several years of work in it without locking up the editor.
export const MAX_LIST = 20_000;
// Folders the bounded directory walk skips (so the list command doesn't walk node_modules).
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist"]);

export interface OpenedFile {
  path: string;
  exists: boolean;
  text: string;
  hash: string | null;
  mtime: number | null;
  size: number;
}

export interface FileStat {
  exists: boolean;
  mtime: number | null;
  size: number;
}

export interface SaveResult {
  hash: string;
  mtime: number;
}

// What file-access refuses: outside the cwd, inside .git, or a secret the thread can't read.
// The error is plain English so the editor can show it in a toast.
export class FileAccessError extends Error {
  constructor(message: string, readonly code: "outside" | "git" | "secret" | "binary" | "missing") {
    super(message);
    this.name = "FileAccessError";
  }
}

// Resolves `input` against `cwd`: absolute paths must be inside cwd; relative paths are joined.
// Realpaths the deepest existing ancestor so a symlink can't escape (a symlinked folder inside
// cwd that points outside is the trick a malicious repo would try). The rel path is then the
// unresolved remainder under that realpath, so the .git / secret checks match what the user
// typed, and the absolute path is the one on disk.
export async function safePath(cwd: string, input: string): Promise<{ abs: string; rel: string; root: string }> {
  if (typeof input !== "string") throw new FileAccessError("A path is required.", "outside");
  // A path with a NUL or other control character is a sign of a malformed request; we treat
  // it like an out-of-tree path.
  if (/[\u0000]/.test(input)) throw new FileAccessError("Bad path.", "outside");
  const trimmed = input.replace(/^\/+/, "");
  const candidate = path.isAbsolute(input) ? input : path.join(cwd, trimmed);
  const realCwd = await fsp.realpath(cwd);
  // Walk up from the candidate until we find a realpath. We use the realpath of the deepest
  // existing ancestor as the base for the inside-cwd check, and the unresolved remainder
  // becomes the rel. On macOS, /tmp/... and /private/tmp/... are the same folder; without
  // this, a candidate that doesn't exist would compare its unresolved path to realCwd and
  // start with "../../..".
  let base = candidate;
  let remainder: string[] = [];
  // Walk up from the candidate until we find an existing ancestor. cwd itself always
  // exists, so we always find one — a runaway loop here is impossible.
  for (;;) {
    try {
      const real = await fsp.realpath(base);
      const abs = remainder.length ? path.join(real, ...remainder) : real;
      const rel = path.relative(realCwd, abs);
      const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      if (!inside) throw new FileAccessError(`${input} is outside the card's folder.`, "outside");
      // Anything inside a .git, a nested repo's or a submodule's included, is git's own state, not something a user opens.
      if (rel.split(path.sep).includes(".git")) throw new FileAccessError(`${input} is inside .git.`, "git");
      // Same secret guard the thread sees: .env files, Weft's own sign-in tokens, etc.
      if (isSecretFile(abs)) throw new FileAccessError(`${input} is a secret file; the editor can't open it.`, "secret");
      return { abs, rel, root: realCwd };
    } catch (err) {
      if (err instanceof FileAccessError) throw err;
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    remainder = [path.basename(base), ...remainder];
    base = path.dirname(base);
  }
}

function sha1(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

// What a file that left the card's folder between the check and the open throws (lib/file-handle.ts).
const escaped = (input: string) => () => new FileAccessError(`${input} moved outside the card's folder.`, "outside");

// Reads the first 8 KB through the handle; a NUL byte means binary. A text file can theoretically have a NUL too, but
// it's almost always a binary, and refusing is the safe default. The size check and the read use the same handle.
async function readText(abs: string, root: string, input: string): Promise<{ text: string; hash: string; size: number; mtime: number }> {
  const fh = await openInside(abs, root, escaped(input));
  try {
    const buf = Buffer.alloc(BINARY_SNIFF);
    const { bytesRead } = await fh.read(buf, 0, BINARY_SNIFF, 0);
    if (buf.subarray(0, bytesRead).includes(0)) throw new FileAccessError("Binary files can't be opened in the editor.", "binary");
    const stat = await fh.stat();
    if (stat.size > MAX_READ) throw new FileAccessError(`File is larger than ${MAX_READ} bytes; the editor won't open it.`, "binary");
    const text = await fh.readFile("utf8");
    return { text, hash: sha1(text), size: stat.size, mtime: Math.floor(stat.mtimeMs) };
  } finally {
    await fh.close();
  }
}

export async function readFile(cwd: string, input: string): Promise<OpenedFile> {
  const { abs, rel, root } = await safePath(cwd, input);
  // readText refuses binaries and oversize files with FileAccessError, and reads utf8. The
  // only "the file disappeared" path is ENOENT from the underlying stat/readFile, which
  // we turn into an exists:false result so the editor can show a placeholder.
  try {
    const { text, hash, size, mtime } = await readText(abs, root, input);
    return { path: rel, exists: true, text, hash, mtime, size };
  } catch (err) {
    if (err instanceof FileAccessError) throw err;
    return { path: rel, exists: false, text: "", hash: null, mtime: null, size: 0 };
  }
}

export async function statFile(cwd: string, input: string): Promise<FileStat & { path: string }> {
  const { abs, rel } = await safePath(cwd, input);
  // safePath already confirmed the deepest existing ancestor realpaths, so by the time we
  // stat the file the only realistic failure is ENOENT (the file was deleted in between).
  try {
    const stat = await fsp.stat(abs);
    return { path: rel, exists: true, mtime: Math.floor(stat.mtimeMs), size: stat.size };
  } catch {
    return { path: rel, exists: false, mtime: null, size: 0 };
  }
}

// git show HEAD:./<path> run via execFile (no shell). Returns null when the folder isn't a
// git repo, the file is untracked, or the file was deleted from the index. Errors don't throw
// past this layer so the editor can show a placeholder.
export async function headOf(cwd: string, input: string): Promise<{ path: string; text: string | null }> {
  const { rel } = await safePath(cwd, input);
  try {
    const { stdout } = await execFileAsync("git", ["show", `HEAD:./${rel}`], { cwd, maxBuffer: MAX_READ });
    return { path: rel, text: stdout };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // git's exit code for "path not in HEAD" is 128 with "fatal: path ... not in HEAD".
    // We treat every failure as "not in HEAD".
    if (code === "ENOENT") return { path: rel, text: null };
    return { path: rel, text: null };
  }
}

// git ls-files --cached --others --exclude-standard, capped at MAX_LIST. Falls back to a
// bounded directory walk when the folder isn't a repo (a freshly-cloned project on the way in,
// or a card that points at a path with no .git).
export async function listFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd, maxBuffer: 8 * 1024 * 1024 },
    );
    const files = stdout.split("\0").filter(Boolean);
    return files.slice(0, MAX_LIST);
  } catch {
    return walkFiles(cwd);
  }
}

async function walkFiles(cwd: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [cwd];
  while (stack.length > 0 && out.length < MAX_LIST) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.length >= MAX_LIST) break;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(path.relative(cwd, abs));
      }
    }
  }
  return out;
}

// Saves `text` to `path` in `cwd`, refusing to overwrite when the file on disk no longer matches
// `baseHash`. A null baseHash means "I never read this file; refuse if it now exists". An
// undefined baseHash skips the check (overwrite blindly).
export async function writeFile(
  cwd: string,
  input: string,
  text: string,
  baseHash?: string | null,
): Promise<{ result: SaveResult } | { conflict: OpenedFile }> {
  const { abs, root } = await safePath(cwd, input);
  if (baseHash !== undefined) {
    // readFile catches its own errors and returns {exists: false} for a missing file, and
    // throws a FileAccessError for the safety refusals (.git, secret, outside). A safety
    // refusal is a real error here too, so let it pass through.
    const current = await readFile(cwd, input);
    const want = baseHash === null ? null : baseHash;
    const have = current.exists ? current.hash : null;
    if (want !== have) return { conflict: current };
  }
  // Atomic and race-checked: a temp file in the parent's realpath, checked again right before the rename onto the
  // target (lib/file-handle.ts).
  const target = await writeInside(abs, root, text, escaped(input));
  const stat = await fsp.stat(target);
  return { result: { hash: sha1(text), mtime: Math.floor(stat.mtimeMs) } };
}