import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pluginInstalls } from "./skill-library";
import { scanFiles } from "./skill-scan";
import { RULES } from "./skill-scan-rules";
import { skillDirs } from "./skills";
import { DATA_DIR } from "./store";
import type { SkillFile, SkillScan } from "./types";

// The scan of the skills you already have: each skill folder and plugin in the library, read and run through
// lib/skill-scan.ts each time the ✦ drawer opens. ~/.weft/skill-scans.json keeps each folder's scan with a
// signature of its files (path, size, mtime), so only a skill that changed is read again.

export const SCANS_FILE = path.join(DATA_DIR, "skill-scans.json");
const MAX_FILES = 400;
const MAX_FILE_BYTES = 512_000;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build"]);

interface Entry {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

function walk(root: string, rel = "", out: Entry[] = []): Entry[] {
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of names) {
    if (out.length >= MAX_FILES) break;
    const childRel = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name)) walk(root, childRel, out);
    } else if (d.isFile()) {
      const abs = path.join(root, childRel);
      const st = fs.statSync(abs);
      out.push({ rel: childRel, abs, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

// The rules' own text is part of it, so a change to a rule rescans every skill.
const RULES_KEY = RULES.map((r) => `${r.id}:${r.severity}:${r.pattern.source}`).join("\n");
const signature = (entries: Entry[]) =>
  crypto
    .createHash("sha1")
    .update(RULES_KEY)
    .update(entries.map((e) => `${e.rel}:${e.size}:${e.mtimeMs}`).join("\n"))
    .digest("hex");

// A file too big to read is scanned by its name alone, so a binary still shows as one.
function readEntry(e: Entry): SkillFile {
  if (e.size > MAX_FILE_BYTES) return { path: e.rel, contents: "" };
  const buf = fs.readFileSync(e.abs);
  return { path: e.rel, contents: buf.includes(0) ? "\u0000" : buf.toString("utf8") };
}

type Cache = Record<string, { sig: string; scan: SkillScan }>;

function readCache(): Cache {
  try {
    const parsed = JSON.parse(fs.readFileSync(SCANS_FILE, "utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

export function scanDir(dir: string, cache: Cache = {}): { scan: SkillScan; sig: string } {
  const entries = walk(dir);
  const sig = signature(entries);
  const hit = cache[dir];
  if (hit?.sig === sig) return hit;
  return { scan: scanFiles(entries.map(readEntry)), sig };
}

// Every skill's and plugin's scan in a folder's library, keyed by skill name or plugin id.
export function scanLibrary(cwd?: string): Record<string, SkillScan> {
  const cache = readCache();
  const next: Cache = { ...cache };
  const out: Record<string, SkillScan> = {};
  const targets = [...skillDirs(cwd), ...pluginInstalls().filter((p) => p.installPath).map((p) => ({ name: p.id, dir: p.installPath }))];
  let changed = false;
  for (const { name, dir } of targets) {
    const result = scanDir(dir, cache);
    out[name] = result.scan;
    if (cache[dir]?.sig !== result.sig) {
      next[dir] = result;
      changed = true;
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(SCANS_FILE), { recursive: true });
    fs.writeFileSync(SCANS_FILE, JSON.stringify(next));
  }
  return out;
}
