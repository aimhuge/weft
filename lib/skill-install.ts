import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { latestStored, readFiles, storeSkill, type StoredSkill } from "./skill-cache";
import { downloadSkill, localNames, REGISTRY } from "./skill-registry";
import { remoteTarget, reviewState } from "./skill-review";
import type { RemoteSkillPreview, SkillScan } from "./types";

// A skill from skills.sh, from preview to install. Both go through Weft's own copy (lib/skill-cache.ts):
// the preview fetches it (or reads the copy kept when skills.sh is down) and shows its scan and any AI
// review; the install writes that same copy to ~/.claude/skills/<name>, where every runner finds it.

const userSkillsDir = () => path.join(os.homedir(), ".claude", "skills");

// The skill as skills.sh has it now, kept; else the newest copy kept, marked offline.
async function fetchStored(id: string): Promise<{ stored: StoredSkill; offline: boolean }> {
  try {
    const { files, hash } = await downloadSkill(id);
    return { stored: storeSkill(id, hash, files), offline: false };
  } catch (err) {
    const kept = latestStored(id);
    if (!kept) throw err;
    return { stored: kept, offline: true };
  }
}

export async function previewSkill(id: string, cwd?: string): Promise<RemoteSkillPreview> {
  const { stored, offline } = await fetchStored(id);
  const target = remoteTarget(id, stored.meta.hash);
  const files = readFiles(stored.filesDir);
  return {
    id,
    source: id.split("/").slice(0, 2).join("/"),
    name: stored.meta.name,
    description: stored.meta.description,
    hash: stored.meta.hash,
    files: files.map((f) => ({ path: f.path, bytes: f.contents.length })),
    scan: stored.scan,
    review: target ? reviewState(target) : { status: "none" },
    installed: localNames(cwd).has(stored.meta.name),
    ...(offline ? { offline } : {}),
  };
}

export class SkillInstallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly scan?: SkillScan,
  ) {
    super(message);
  }
}

// A danger verdict, or an AI review that says unsafe, needs `force`: the drawer only sends it after you've
// read the findings and chosen Install anyway.
export async function installSkill(id: string, { force = false }: { force?: boolean } = {}): Promise<{ name: string; dir: string; scan: SkillScan }> {
  const { stored } = await fetchStored(id);
  const { name, hash } = stored.meta;
  const { scan } = stored;
  const target = remoteTarget(id, hash);
  const review = target ? reviewState(target) : undefined;
  const unsafe = scan.verdict === "danger" || (review?.status === "done" && review.review.verdict === "unsafe");
  if (unsafe && !force) throw new SkillInstallError("Weft's scan found something dangerous in this skill.", 409, scan);
  const root = userSkillsDir();
  const dir = path.join(root, name);
  if (fs.existsSync(dir)) throw new SkillInstallError(`You already have a skill named ${name}.`, 409, scan);
  // Copied beside it under a dot name (lib/skills.ts skips those), then renamed, so a half-written skill never shows.
  const tmp = path.join(root, `.${name}.${crypto.randomBytes(4).toString("hex")}.tmp`);
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.cpSync(stored.filesDir, tmp, { recursive: true, dereference: false, verbatimSymlinks: true });
    fs.writeFileSync(path.join(tmp, ".weft-source.json"), `${JSON.stringify({ registry: REGISTRY, id, hash, installedAt: new Date().toISOString(), verdict: scan.verdict }, null, 2)}\n`);
    fs.renameSync(tmp, dir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return { name, dir, scan };
}
