import fs from "node:fs";
import path from "node:path";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";
import { resetMs, type LimitKind, type LimitSample } from "./limit-chart";
import { poolKey } from "./plan-pools";
import type { Backend, CardStats } from "./types";

// The plan limits over time, for the status strip's burndown chart (components/LimitBurndown.tsx): a
// card only keeps the latest 5-hour and weekly window, so each change is also appended to
// ~/.weft/limits.jsonl, one sample per line, naming the CLI that reported it. A week and a day of it
// is kept.
//
// A sample names the CLI that REPORTED a reading; the window it carries is the plan's (lib/plan-pools.ts).
// So what Weft remembers between two samples is per PLAN: one account's counter, read by whichever CLI
// last reported it. Keying that memory per CLI would log the same window twice and see one reset twice.

export const LIMITS_FILE = path.join(DATA_DIR, "limits.jsonl");
export const KEEP_MS = 8 * 24 * 60 * 60 * 1000;

interface Log {
  last: Map<string, LimitSample>;
  compacted: boolean;
  // Fires when a window transitions from used >= 100 to used < 100 between two samples we logged.
  // Set by setOnLimitReset (lib/limit-resume.ts wires it on first import). One global hook per
  // process: the poll is the only producer, and one consumer is enough.
  onReset?: (sample: LimitSample) => void;
}

const log = () => globalSingleton<Log>("__weftLimits", () => ({ last: new Map(), compacted: false }));

// Subscribe to "limit just reset" transitions: the moment a window's `used` drops from
// 100% (or above) to below 100% between two recordLimits calls. Returns the previous
// handler so callers can chain or restore. lib/limit-poll.ts calls recordLimits every
// 15 min, so this is also the rate at which the signal fires.
export function setOnLimitReset(handler: (sample: LimitSample) => void): ((sample: LimitSample) => void) | undefined {
  const l = log();
  const prev = l.onReset;
  l.onReset = handler;
  return prev;
}

// What Weft remembers between two samples, per PLAN and window: the plan's counter is one, so the
// memory of it is one, whichever CLI reported it.
const key = (backend: Backend, kind: LimitKind) => `${poolKey(backend)}:${kind}`;

function parse(line: string): LimitSample | null {
  try {
    const s = JSON.parse(line) as LimitSample;
    return typeof s.at === "number" && typeof s.used === "number" && typeof s.kind === "string" && typeof s.backend === "string" ? s : null;
  } catch {
    return null;
  }
}

// Every sample still kept, oldest first; the first read of a process drops the older lines from the file.
export function readSamples(now = Date.now()): LimitSample[] {
  let text = "";
  try {
    text = fs.readFileSync(LIMITS_FILE, "utf8");
  } catch {
    return [];
  }
  const all = text.split("\n").filter(Boolean).map(parse).filter((s): s is LimitSample => s !== null);
  const kept = all.filter((s) => now - s.at <= KEEP_MS);
  const l = log();
  if (!l.compacted) {
    l.compacted = true;
    if (kept.length < all.length) fs.writeFileSync(LIMITS_FILE, kept.map((s) => JSON.stringify(s)).join("\n") + (kept.length ? "\n" : ""));
  }
  return kept.sort((a, b) => a.at - b.at);
}

// The samples a stats patch adds: a window whose share or reset changed since the last one seen.
export function changedSamples(backend: Backend, patch: Partial<CardStats>, last: Map<string, LimitSample>, now: number): LimitSample[] {
  const windows: [LimitKind, CardStats["fiveHour"]][] = [["five_hour", patch.fiveHour], ["seven_day", patch.sevenDay]];
  const out: LimitSample[] = [];
  for (const [kind, w] of windows) {
    if (!w) continue;
    const prev = last.get(key(backend, kind));
    // The reset to the minute: the CLI reports one reset a few hundred ms apart from call to call.
    const reset = resetMs(w.resetsAt);
    if (prev && prev.used === w.used && resetMs(prev.resetsAt) === reset) continue;
    out.push({ at: now, backend, kind, used: w.used, ...(reset !== undefined && { resetsAt: reset / 1000 }) });
  }
  return out;
}

// Logs what a thread just learned about its plan's limits (lib/runner-turn.ts). Never throws: the chart
// is a nicety, the turn isn't. When a window's used share drops from >=100 to <100 between two
// samples, fires the onReset hook (lib/limit-resume.ts) so parked cards on that plan get replayed.
export function recordLimits(backend: Backend, patch: Partial<CardStats>, now = Date.now()) {
  const l = log();
  if (!l.last.size) for (const s of readSamples(now)) l.last.set(key(s.backend, s.kind), s);
  const fresh = changedSamples(backend, patch, l.last, now);
  if (!fresh.length) return;
  // Detect the reset before overwriting `last`: a window was at/above 100% in our last reading
  // and is now below 100%. The hook is what auto-resumes parked cards; never let it break the chart.
  for (const s of fresh) {
    const prev = l.last.get(key(s.backend, s.kind));
    if (prev && prev.used >= 100 && s.used < 100) {
      try { l.onReset?.(s); } catch { /* the hook must never break the chart */ }
    }
  }
  for (const s of fresh) l.last.set(key(s.backend, s.kind), s);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(LIMITS_FILE, fresh.map((s) => JSON.stringify(s)).join("\n") + "\n");
  } catch {}
}
