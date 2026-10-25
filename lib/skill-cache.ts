import fs from "node:fs";
import path from "node:path";
import { safeRelPath, skillMeta } from "./skill-registry";
import { scanFiles } from "./skill-scan";
import { DATA_DIR } from "./store";
import type { SkillFile, SkillReview, SkillScan } from "./types";

// Weft's own copy of the registry: every skill it has fetched from skills.sh, kept by content hash with its
// static scan and its AI review, in ~/.weft/skill-registry/<owner>/<repo>/<skill>/<hash>/:
//   files/        the skill as it came down
//   meta.json     id, name, description, hash, when fetched
//   scan.json     lib/skill-scan.ts's result
//   review.json   lib/skill-review.ts's result
// A skill is never scanned or reviewed twice at the same hash (the review is the costly part), the drawer
// still shows a skill when skills.sh is down, and an install writes exactly the copy that was reviewed.

export const CACHE_DIR = path.join(DATA_DIR, "skill-registry");

export interface StoredMeta {
  id: string;
  name: string;
  description: string;
  hash: string;
  fetchedAt: string;
}

export interface StoredSkill {
  dir: string;
  filesDir: string;
  meta: StoredMeta;
  scan: SkillScan;
}

const HASH = /^[a-f0-9]{16,128}$/;

export function entryDir(id: string, hash: string): string {
  if (!HASH.test(hash)) throw new Error("Not a content hash.");
  const parts = id.split("/");
  if (parts.length !== 3 || parts.some((p) => !/^[\w.:-]+$/.test(p) || p === "." || p === "..")) throw new Error("Not a skills.sh skill id.");
  return path.join(CACHE_DIR, ...parts.map((p) => p.replaceAll(":", "_")), hash);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

const writeJson = (file: string, value: unknown) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// Keeps a download (once per hash) and its scan; a hash already kept is read back with the scan it has.
export function storeSkill(id: string, hash: string, files: SkillFile[]): StoredSkill {
  const dir = entryDir(id, hash);
  const filesDir = path.join(dir, "files");
  const kept = readStored(id, hash);
  if (kept) return kept;
  fs.rmSync(dir, { recursive: true, force: true });
  for (const f of files) {
    const target = path.join(filesDir, safeRelPath(f.path) ?? "");
    if (target === filesDir) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f.contents);
  }
  const meta: StoredMeta = { id, hash, ...skillMeta(files, id.split("/")[2] ?? ""), fetchedAt: new Date().toISOString() };
  const scan = scanFiles(files);
  writeJson(path.join(dir, "scan.json"), scan);
  // Written last, so a copy without it is one that didn't finish.
  writeJson(path.join(dir, "meta.json"), meta);
  return { dir, filesDir, meta, scan };
}

export function readStored(id: string, hash: string): StoredSkill | undefined {
  const dir = entryDir(id, hash);
  const meta = readJson(path.join(dir, "meta.json")) as StoredMeta | undefined;
  const filesDir = path.join(dir, "files");
  if (!meta) return undefined;
  const scan = (readJson(path.join(dir, "scan.json")) as SkillScan | undefined) ?? scanFiles(readFiles(filesDir));
  return { dir, filesDir, meta, scan };
}

// The newest copy kept of a skill, for when skills.sh can't be reached.
export function latestStored(id: string): StoredSkill | undefined {
  let hashes: string[];
  try {
    hashes = fs.readdirSync(path.dirname(entryDir(id, "0".repeat(16)))).filter((h) => HASH.test(h));
  } catch {
    return undefined;
  }
  return hashes
    .map((h) => readStored(id, h))
    .filter((s): s is StoredSkill => Boolean(s))
    .sort((a, b) => b.meta.fetchedAt.localeCompare(a.meta.fetchedAt))[0];
}

export function readFiles(root: string, rel = ""): SkillFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((d) => {
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) return readFiles(root, childRel);
    return d.isFile() ? [{ path: childRel, contents: fs.readFileSync(path.join(root, childRel), "utf8") }] : [];
  });
}

export const readReview = (dir: string) => readJson(path.join(dir, "review.json")) as SkillReview | undefined;
export const writeReview = (dir: string, review: SkillReview) => writeJson(path.join(dir, "review.json"), review);
