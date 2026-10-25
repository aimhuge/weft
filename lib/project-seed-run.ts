import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { applyIssues } from "./github-issues";
import { globalSingleton } from "./global-singleton";
import { onProjectOpen } from "./project-open";
import { pickSeeds, seedLine, type Seed } from "./project-seed";
import { findSeeds, FIND_DEPS } from "./project-seed-find";
import { defaultBackend, defaultPermissionMode, listProjects } from "./settings";
import { addCards, DATA_DIR, listCards } from "./store";
import type { Card } from "./types";

// Seeds a project's Backlog once, the first time it lands on the board (lib/project-open.ts), in the background:
// a few parked cards from what Weft can already see (lib/project-seed-find.ts). The project menu's Re-seed Backlog
// runs it again. Which projects have been seeded is kept in ~/.weft/project-seeds.json.

const SEEDS_FILE = path.join(DATA_DIR, "project-seeds.json");
// Long enough after a project opens that a card started in it gets its CLI first.
const SEED_DELAY_MS = 5_000;
const CHIP_TTL_MS = 10 * 60_000;

const g = globalSingleton("__weftProjectSeed", () => ({
  inflight: new Map<string, Promise<number>>(),
  chips: new Map<string, { at: number; lines: Promise<string[]> }>(),
}));

export function readSeeded(file = SEEDS_FILE): Record<string, number> | null {
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as { seeded?: Record<string, number> }).seeded ?? {};
  } catch {
    return null;
  }
}

function writeSeeded(seeded: Record<string, number>, file = SEEDS_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ seeded }, null, 2));
}

export function markSeeded(folder: string, at = Date.now(), file = SEEDS_FILE) {
  writeSeeded({ ...readSeeded(file), [folder]: at }, file);
}

const inFolder = (cwd: string, folder: string) => cwd === folder || cwd.startsWith(`${folder}/`);

function draftCard(folder: string, seed: Seed, now: number): Card {
  return {
    id: randomUUID(),
    column: "backlog",
    title: seed.title,
    titleBy: "user",
    prompt: seed.prompt,
    cwd: folder,
    backend: defaultBackend(),
    permissionMode: defaultPermissionMode(),
    createdAt: now,
    updatedAt: now,
  };
}

// Makes the picked seeds' cards: issues through the issue importer (so a later sync knows them), the rest at once.
function makeCards(folder: string, seeds: Seed[]): number {
  let added = 0;
  for (const s of seeds) if (s.issue) added += applyIssues(folder, s.issue.repo, [s.issue.issue]).added;
  const now = Date.now();
  const drafts = seeds.filter((s) => !s.issue).map((s) => draftCard(folder, s, now));
  if (drafts.length) addCards(drafts);
  return added + drafts.length;
}

async function runSeed(folder: string, force: boolean, deps: typeof FIND_DEPS): Promise<number> {
  if (!force && readSeeded()?.[folder] !== undefined) return 0;
  if (!fs.existsSync(folder)) return 0;
  // Marked before looking, so a second open while this runs doesn't seed it twice.
  markSeeded(folder);
  const existing = listCards().filter((c) => inFolder(c.cwd, folder));
  return makeCards(folder, pickSeeds(await findSeeds(folder, deps), existing));
}

// Seeds the folder's Backlog (once, unless forced) and says how many cards it added. One run per folder at a time.
export function seedProject(folder: string, { force = false, deps = FIND_DEPS } = {}): Promise<number> {
  const running = g.inflight.get(folder);
  if (running) return running;
  const job = runSeed(folder, force, deps).finally(() => g.inflight.delete(folder));
  g.inflight.set(folder, job);
  return job;
}

// Once per server (from prewarm()). The first time, every project already on the board counts as seeded, so
// turning this on doesn't flood an existing board; Re-seed Backlog is there for those.
export function startProjectSeed() {
  if (readSeeded() === null) writeSeeded(Object.fromEntries(listProjects().map((p) => [p.path, 0])));
  onProjectOpen("seed", (folder) => {
    setTimeout(() => {
      seedProject(folder).catch((err: unknown) => console.warn(`[weft] seeding ${folder} failed:`, err));
    }, SEED_DELAY_MS).unref();
  });
}

// The copilot's chips: what each project's starter cards would be now, minus what's on the board. Kept 10 minutes.
export async function seedChipLines(projects: readonly string[], deps = FIND_DEPS): Promise<string[]> {
  const all = await Promise.all(
    projects.map((folder) => {
      const hit = g.chips.get(folder);
      if (hit && Date.now() - hit.at < CHIP_TTL_MS) return hit.lines;
      const lines = findSeeds(folder, deps).then((seeds) =>
        pickSeeds(seeds, deps.cards().filter((c) => inFolder(c.cwd, folder))).map((s) => seedLine(path.basename(folder), s)),
      );
      g.chips.set(folder, { at: Date.now(), lines });
      void lines.catch(() => g.chips.delete(folder));
      return lines;
    }),
  );
  return all.flat();
}
