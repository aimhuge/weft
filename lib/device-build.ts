// A worker's build arriving on the Mac (docs/architecture/manual-qa.md): streamed from R2 into DATA_DIR/qa-builds, hashed on
// the way in because a presigned upload can't prove its bytes match the name, and unpacked only after the zip's names and
// the links inside it are checked. A .app is a folder, so it travels zipped; an .apk is one file.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebStream } from "node:stream/web";
import { promisify } from "node:util";
import type { BuildRef } from "./device-call";
import { MAX_BUILD_BYTES } from "./device-limits";
import { DATA_DIR } from "./store";

const exec = promisify(execFile);

// A day, the same as the object's life in R2.
const KEEP_MS = 24 * 60 * 60_000;

export const buildsDir = () => path.join(DATA_DIR, "qa-builds");

export type Sh = (cmd: string, args: string[]) => Promise<string>;
const sh: Sh = async (cmd, args) => (await exec(cmd, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;

// Names that would land outside the folder. A real .app holds none.
export function badZipName(name: string) {
  return name.startsWith("/") || name.includes("\\") || name.split("/").includes("..");
}

// Every symlink in the tree has to land inside it, and the only entries are files, folders and links.
export function checkTree(root: string) {
  const top = fs.realpathSync(root);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isSymbolicLink()) {
        const target = path.resolve(path.dirname(file), fs.readlinkSync(file));
        const inside = target === top || target.startsWith(`${top}${path.sep}`);
        if (!inside) throw new Error(`That build has a link leaving it: ${path.relative(top, file)}`);
      } else if (!entry.isFile()) throw new Error(`That build holds something that isn't a file: ${path.relative(top, file)}`);
    }
  };
  walk(top);
}

export function sweepBuilds(dir = buildsDir(), now = Date.now()) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (now - fs.statSync(file).mtimeMs > KEEP_MS) fs.rmSync(file, { recursive: true, force: true });
  }
}

// Into a temp file with its hash taken on the way, cut off the moment it passes the cap.
export async function downloadBuild(url: string, build: BuildRef, dir = buildsDir(), fetcher: typeof fetch = fetch): Promise<string> {
  if (build.bytes > MAX_BUILD_BYTES) throw new Error("That build is over the 500 MB limit.");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${build.sha}.download`);
  const res = await fetcher(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't fetch the build: HTTP ${res.status}`);
  const hash = createHash("sha256");
  let seen = 0;
  const count = async function* (source: AsyncIterable<Uint8Array>) {
    for await (const chunk of source) {
      seen += chunk.length;
      if (seen > MAX_BUILD_BYTES) throw new Error("That build is over the 500 MB limit.");
      hash.update(chunk);
      yield chunk;
    }
  };
  try {
    await pipeline(Readable.fromWeb(res.body as WebStream), count, fs.createWriteStream(file, { mode: 0o600 }));
    if (hash.digest("hex") !== build.sha) throw new Error("That build's bytes don't match its hash, so it wasn't installed.");
    return file;
  } catch (err) {
    fs.rmSync(file, { force: true });
    throw err;
  }
}

// The path simctl or adb takes: the .apk itself, or the one .app inside the zip.
export async function unpackBuild(file: string, build: BuildRef, dir = buildsDir(), run: Sh = sh): Promise<string> {
  if (build.kind === "apk") {
    const apk = path.join(dir, `${build.sha}.apk`);
    fs.renameSync(file, apk);
    return apk;
  }
  const names = (await run("unzip", ["-Z1", file])).split("\n").filter(Boolean);
  const bad = names.find(badZipName);
  if (bad) throw new Error(`That build has a path leaving it: ${bad}`);
  const out = path.join(dir, build.sha);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { mode: 0o700 });
  try {
    await run("ditto", ["-x", "-k", file, out]);
    checkTree(out);
    const apps = fs.readdirSync(out).filter((n) => n.endsWith(".app"));
    const app = apps[0];
    if (apps.length !== 1 || !app) throw new Error("That zip doesn't hold exactly one .app.");
    return path.join(out, app);
  } catch (err) {
    fs.rmSync(out, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(file, { force: true });
  }
}
