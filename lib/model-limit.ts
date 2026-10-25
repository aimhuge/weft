import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalSingleton } from "./global-singleton";

// Which models are exhausted, and until when. The plan limits are per model on Anthropic's and
// Puku's side (Opus has its own weekly cap, Sonnet another), so a hit on one model says nothing
// about the others — Weft has to know which model ran out, not just which CLI. This is the store:
// a small JSON file in ~/.weft, so it survives a restart and the board can ask "is this model
// any good right now?" before it starts a thread on it.
//
// A hit is written when a thread's turn comes back with a limit error (lib/rate-limit.ts) and read
// by the model pickers (so an exhausted model is marked) and by the thread starter (so a new or
// running thread moves to the backup model instead).

// Where the file lives. Computed on each call, not at import: the path depends on WEFT_DATA, which
// the tests set, and it keeps this module off ./store — the store's own DATA_DIR is a module-level
// constant, so importing it here would make every test that mocks ./store break on load.
function limitsFile() {
  return path.join(process.env.WEFT_DATA || path.join(os.homedir(), ".weft"), "model-limits.json");
}

// How long a hit is remembered without a reset time. The message usually names one; when it
// doesn't, the window's length is a good enough guess (5 hours for the session window).
const DEFAULT_TTL_MS = 5 * 60 * 60 * 1000;

// One model's exhaustion: when it ran out, and when it comes back (unix ms).
export interface ModelLimit {
  model: string;
  at: number;
  resetsAt: number;
}

// The whole file: the hits we still remember, newest last.
interface Store {
  limits: ModelLimit[];
}

const store = () => globalSingleton<Store>("__weftModelLimits", () => ({ limits: [] }));

function parse(text: string): Store {
  try {
    const raw = JSON.parse(text) as { limits?: unknown };
    const limits = Array.isArray(raw.limits) ? raw.limits : [];
    return {
      limits: limits.filter(
        (l): l is ModelLimit =>
          Boolean(l) &&
          typeof (l as ModelLimit).model === "string" &&
          typeof (l as ModelLimit).at === "number" &&
          typeof (l as ModelLimit).resetsAt === "number",
      ),
    };
  } catch {
    return { limits: [] };
  }
}

function read(): Store {
  try {
    return parse(fs.readFileSync(limitsFile(), "utf8"));
  } catch {
    return { limits: [] };
  }
}

function write(next: Store) {
  const s = store();
  s.limits = next.limits;
  try {
    const file = limitsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2));
  } catch {
    // The store is a nicety: a thread that can't write it still runs, it just isn't remembered.
  }
}

// The hits we still remember, the ones whose reset has passed dropped. Read from disk each time
// so a second process (the board's server and a card's turn) sees the same thing.
export function modelLimits(now = Date.now()): ModelLimit[] {
  const all = read().limits;
  const live = all.filter((l) => l.resetsAt > now);
  if (live.length !== all.length) write({ limits: live });
  return live;
}

// Records that a model ran out. The newest hit for a model wins: a second hit on the same model
// moves its reset further out.
export function recordModelLimit(model: string, at: number, resetsAt?: number) {
  if (!model) return;
  const until = resetsAt && resetsAt > at ? resetsAt : at + DEFAULT_TTL_MS;
  const all = modelLimits(at).filter((l) => l.model !== model);
  all.push({ model, at, resetsAt: until });
  write({ limits: all });
}

// Whether a model is exhausted right now, and when it comes back.
export function modelLimit(model: string | undefined, now = Date.now()): ModelLimit | undefined {
  if (!model) return undefined;
  return modelLimits(now).find((l) => l.model === model);
}

// Whether a model is exhausted right now. A model with no hit is fine.
export function isModelLimited(model: string | undefined, now = Date.now()): boolean {
  return modelLimit(model, now) !== undefined;
}

// Forgets a model's hit, so a thread can go back to it (the user picked it by hand, or its
// window reset and Weft noticed).
export function clearModelLimit(model: string) {
  const all = modelLimits().filter((l) => l.model !== model);
  write({ limits: all });
}

// The models that are exhausted, for the pickers to mark.
export function limitedModels(now = Date.now()): string[] {
  return modelLimits(now).map((l) => l.model);
}

// The reset a limit message names, as a timestamp. The CLI writes it as a local time with a zone:
// "resets 10:40pm (Asia/Bangkok)", or an epoch after a pipe. Returns undefined when neither is
// there, and the caller falls back to the window's own length.
export function resetTimeOf(text: string, at = Date.now()): number | undefined {
  // The epoch form: "|1792268400".
  const epoch = Number(/\|(\d{10})\b/.exec(text)?.[1] ?? 0);
  if (epoch) return epoch * 1000;
  // The local-time form: "resets 10:40pm (Asia/Bangkok)". The zone is an IANA name, so the time
  // is read in that zone; without one, in the machine's own.
  const named = /resets?\s+(?:at\s+|on\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i.exec(text);
  if (!named) return undefined;
  const hour = Number(named[1]);
  const minute = Number(named[2] ?? 0);
  if (Number.isNaN(hour) || hour > 24) return undefined;
  // The time of day in the zone the CLI named, as the milliseconds since the epoch.
  const zone = named[4];
  const ms = zonedTime(twelveHour(hour, named[3]), minute, zone, at);
  if (ms === undefined) return undefined;
  // A reset in the past means the message named the next one: roll it forward a day. The day is
  // re-derived in the zone rather than added as 24 hours, so a zone that shifts its offset across
  // the boundary (a DST change) still lands on the same clock time tomorrow.
  return ms > at ? ms : (zonedTime(twelveHour(hour, named[3]), minute, zone, at + 24 * 60 * 60 * 1000) ?? ms + 24 * 60 * 60 * 1000);
}

// The hour as a 24-hour one: "10:40pm" is 22, "12:30am" is 0.
function twelveHour(hour: number, meridiem: string | undefined): number {
  const m = meridiem?.toLowerCase();
  if (m === "pm" && hour < 12) return hour + 12;
  if (m === "am" && hour === 12) return 0;
  return hour;
}

// The time of day (hour:minute) on the calendar day that `at` falls on in a named IANA zone, as
// unix ms. Undefined when the zone is unknown. Uses Intl, which knows the zone's offset on that
// date.
//
// The calendar day is read IN THE ZONE, not from the UTC date: at 19:21 UTC on the 25th it is
// already the 26th in Bangkok (UTC+7), and a target built on the UTC date would name yesterday.
function zonedTime(hour: number, minute: number, zone: string | undefined, at: number): number | undefined {
  // The zone's own calendar day for `at`: year, month and day as the zone reads them.
  const day = zoneDate(at, zone);
  if (!day) return undefined;
  // The target as a wall-clock time in the zone, held as UTC-shaped parts. The instant it names
  // is that reading minus the zone's offset at that moment; the offset depends on the instant, so
  // it is found by iterating until it stops moving (two rounds is enough for every real zone).
  let parts = { year: day.year, month: day.month, day: day.day };
  let instant = Date.UTC(parts.year, parts.month, parts.day, hour, minute);
  for (let round = 0; round < 4; round++) {
    const offset = zoneOffset(instant, zone);
    if (offset === undefined) return undefined;
    const next = Date.UTC(parts.year, parts.month, parts.day, hour, minute) - offset;
    // Read the wall clock back in the zone: if the offset we used was the wrong one, the reading
    // lands on another day, and that day is the one the target really belongs to.
    const read = zoneDate(next, zone);
    if (!read) return undefined;
    const moved = read.year !== parts.year || read.month !== parts.month || read.day !== parts.day;
    parts = read;
    instant = next;
    if (!moved) return instant;
  }
  return instant;
}

// The calendar day an instant falls on in a zone: { year, month, day }, month 0-based. Undefined
// when the zone is unknown.
function zoneDate(at: number, zone: string | undefined): { year: number; month: number; day: number } | undefined {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      ...(zone ? { timeZone: zone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day) };
  } catch {
    return undefined;
  }
}

// A zone's offset from UTC in ms at an instant, or undefined when the zone is unknown.
function zoneOffset(at: number, zone: string | undefined): number | undefined {
  if (!zone) return -new Date(at).getTimezoneOffset() * 60_000;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - at;
  } catch {
    return undefined;
  }
}

