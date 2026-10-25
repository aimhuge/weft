import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR, latestStored, readReview, readStored, writeReview } from "./skill-cache";
import { runReviewAgent } from "./skill-review-agent";
import { renderReviewPage } from "./skill-review-page";
import { scanDir } from "./skill-scan-library";
import { SHOW_DIR } from "./show-dir";
import { skillDirs } from "./skills";
import type { SkillReviewState, SkillScan } from "./types";

// Starts and tracks a skill's AI review (lib/skill-review-agent.ts) and keeps its page in the pane current.
// A review is kept beside the copy it read (lib/skill-cache.ts), so one per content hash: a skill from
// skills.sh by its registry hash, one you have by its folder's signature (lib/skill-scan-library.ts).
// Starting one writes the page at once with the static scan, then rewrites it when the agent answers.

export interface ReviewTarget {
  key: string;
  name: string;
  source: string;
  filesDir: string;
  // Where review.json is kept.
  storeDir: string;
  scan: SkillScan;
}

export const REVIEW_PAGES = path.join(SHOW_DIR, "skill-reviews");
const running = new Map<string, Promise<void>>();
const failed = new Map<string, string>();

const slug = (key: string) => `${key.replace(/[^\w.-]+/g, "-").slice(0, 80)}-${crypto.createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
export const pageFor = (target: ReviewTarget) => path.join(REVIEW_PAGES, `${slug(target.key)}.html`);

function writePage(target: ReviewTarget, extra: { running?: boolean; error?: string } = {}) {
  const page = pageFor(target);
  fs.mkdirSync(REVIEW_PAGES, { recursive: true });
  fs.writeFileSync(page, renderReviewPage({ name: target.name, source: target.source, scan: target.scan, review: readReview(target.storeDir), ...extra }));
  return page;
}

export function reviewState(target: ReviewTarget): SkillReviewState {
  const review = readReview(target.storeDir);
  if (review) return { status: "done", page: pageFor(target), review };
  if (running.has(target.key)) return { status: "running", page: pageFor(target) };
  const error = failed.get(target.key);
  if (error) return { status: "failed", page: pageFor(target), error };
  return { status: "none" };
}

// Writes the page and, unless a review is kept or running, starts one. Resolves at once with the state.
export function startReview(target: ReviewTarget): SkillReviewState {
  const state = reviewState(target);
  if (state.status === "done") {
    writePage(target);
    return state;
  }
  if (state.status === "running") return state;
  failed.delete(target.key);
  const page = writePage(target, { running: true });
  const job = runReviewAgent(target.filesDir, `${target.name} (${target.source})`, target.scan)
    .then((review) => {
      fs.mkdirSync(target.storeDir, { recursive: true });
      writeReview(target.storeDir, review);
      writePage(target);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      failed.set(target.key, message);
      writePage(target, { error: message });
    })
    .finally(() => running.delete(target.key));
  running.set(target.key, job);
  return { status: "running", page };
}

// For tests: wait for a review to end.
export const settled = (key: string) => running.get(key) ?? Promise.resolve();

// A skill from skills.sh, at the hash Weft kept (the newest when none is given).
export function remoteTarget(id: string, hash?: string): ReviewTarget | undefined {
  const stored = hash ? readStored(id, hash) : latestStored(id);
  if (!stored) return undefined;
  return { key: `remote:${id}@${stored.meta.hash}`, name: stored.meta.name, source: `skills.sh · ${id.split("/").slice(0, 2).join("/")}`, filesDir: stored.filesDir, storeDir: stored.dir, scan: stored.scan };
}

// A skill or plugin you have, by name in a folder's library; its review is keyed by the folder's signature.
export function localTarget(cwd: string | undefined, name: string, pluginDir?: string): ReviewTarget | undefined {
  const dir = pluginDir ?? skillDirs(cwd).find((s) => s.name === name)?.dir;
  if (!dir) return undefined;
  const { scan, sig } = scanDir(dir);
  const storeDir = path.join(CACHE_DIR, "local", crypto.createHash("sha1").update(dir).digest("hex").slice(0, 16), sig.slice(0, 16));
  return { key: `local:${dir}@${sig.slice(0, 16)}`, name, source: dir, filesDir: dir, storeDir, scan };
}
