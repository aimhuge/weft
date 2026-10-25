import crypto from "node:crypto";
import path from "node:path";
import { listSkills } from "./skills";
import type { RemoteSkill, SkillFile } from "./types";

// The open registry at skills.sh, so a search in the ✦ drawer that finds nothing local still finds
// something: `/api/search?q=` (Algolia, with install counts) and `/api/download/<owner>/<repo>/<skill>`
// (every file of the skill as text, and a hash of them). Neither needs a key (checked 2026-10-26).
// What comes down is kept in Weft's own copy (lib/skill-cache.ts), scanned (lib/skill-scan.ts),
// reviewed (lib/skill-review.ts) and installed from there (lib/skill-install.ts).

export const REGISTRY = process.env.WEFT_SKILL_REGISTRY || "https://skills.sh";
const TIMEOUT_MS = 10_000;
// A skill is instructions and a few scripts; anything bigger isn't one.
const MAX_FILES = 300;
const MAX_BYTES = 5_000_000;

export const SKILL_ID = /^[\w.-]+\/[\w.-]+\/[\w.:-]+$/;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json", "user-agent": "Weft" } });
  if (!res.ok) throw new Error(`skills.sh answered ${res.status}.`);
  return res.json();
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const localNames = (cwd?: string) => new Set(listSkills(cwd).map((s) => s.name));

export async function searchSkills(query: string, cwd?: string, limit = 12): Promise<RemoteSkill[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const body = await getJson(`${REGISTRY}/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
  const hits = isObject(body) && Array.isArray(body.skills) ? body.skills : [];
  const local = localNames(cwd);
  return hits.filter(isObject).flatMap((h) => {
    const id = str(h.id);
    if (!SKILL_ID.test(id)) return [];
    const name = str(h.name) || str(h.skillId);
    return [{ id, source: str(h.source), name, installs: typeof h.installs === "number" ? h.installs : 0, installed: local.has(name) }];
  });
}

// A file path from the registry, kept inside the skill's folder.
export function safeRelPath(p: string): string | null {
  if (!p || p.includes("\0") || path.isAbsolute(p) || /^[a-z]:/i.test(p)) return null;
  const norm = path.posix.normalize(p.replaceAll("\\", "/"));
  if (norm === "." || norm === ".." || norm.startsWith("../") || norm.startsWith("/")) return null;
  return norm;
}

// The registry's hash when it sends one, else a sha256 of the files, so a copy is keyed by what's in it.
export function filesHash(files: SkillFile[]): string {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(`${f.path}\0${f.contents}\0`);
  return h.digest("hex");
}

export async function downloadSkill(id: string): Promise<{ files: SkillFile[]; hash: string }> {
  if (!SKILL_ID.test(id)) throw new Error("Not a skills.sh skill id.");
  const body = await getJson(`${REGISTRY}/api/download/${id.split("/").map(encodeURIComponent).join("/")}`);
  const raw = isObject(body) && Array.isArray(body.files) ? body.files : [];
  const files = raw.filter(isObject).map((f) => ({ path: str(f.path), contents: str(f.contents) }));
  if (!files.some((f) => /^SKILL\.md$/i.test(f.path))) throw new Error("That skill has no SKILL.md.");
  if (files.length > MAX_FILES) throw new Error(`That skill has ${files.length} files; Weft takes up to ${MAX_FILES}.`);
  if (files.reduce((n, f) => n + f.contents.length, 0) > MAX_BYTES) throw new Error("That skill is over 5 MB.");
  for (const f of files) if (!safeRelPath(f.path)) throw new Error(`That skill has a file outside its folder: ${f.path}`);
  const sent = isObject(body) ? str(body.hash) : "";
  return { files, hash: /^[a-f0-9]{16,128}$/.test(sent) ? sent : filesHash(files) };
}

// The frontmatter's name and description, as lib/skills.ts reads them; the skill id's last part without a name.
export function skillMeta(files: SkillFile[], fallback: string): { name: string; description: string } {
  const text = files.find((f) => /^SKILL\.md$/i.test(f.path))?.contents ?? "";
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const field = (key: string) => front.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
  const name = field("name");
  const description = field("description");
  return { name: /^[\w.-]+$/.test(name) ? name : fallback, description: description.length > 400 ? `${description.slice(0, 399)}…` : description };
}
