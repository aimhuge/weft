import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseFootprints } from "./dev-traffic";
import { globalSingleton } from "./global-singleton";

// Each dev server process's real memory for the Services drawer (lib/services-snapshot.ts): macOS's phys_footprint as
// `top -stats mem` reads it, RAM plus compressed plus swapped. ps's RSS misses what was swapped out: on 2026-11-15 three
// Next dev servers showed small in ps while holding 18 GB. One `top` costs ~0.4 s, so it runs only while the drawer is
// open (`?footprint=1`), for every pid at once, and its answer is reused for MAX_AGE_MS.

const run = promisify(execFile);
export const MAX_AGE_MS = 15_000;

const cached = () => globalSingleton("__weftFootprints", () => ({ at: 0, kb: new Map<number, number>() }));

type Top = (args: string[]) => Promise<string>;
const top: Top = async (args) => (await run("/usr/bin/top", args, { maxBuffer: 1024 * 1024 })).stdout;

// KB by pid for these pids; a pid top can't read is left out. Never throws: no numbers is better than no drawer.
export async function footprints(pids: readonly number[], now = Date.now(), read: Top = top): Promise<Map<number, number>> {
  if (!pids.length) return new Map();
  const cache = cached();
  const fresh = now - cache.at < MAX_AGE_MS && pids.every((p) => cache.kb.has(p));
  if (fresh) return cache.kb;
  try {
    cache.kb = parseFootprints(await read(["-l", "1", "-stats", "pid,mem", ...pids.flatMap((p) => ["-pid", String(p)])]));
    cache.at = now;
  } catch {
    return new Map();
  }
  return cache.kb;
}
