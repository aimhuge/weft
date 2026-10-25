// A cron's schedule (docs/architecture/crons.md): five-field cron strings ("0 9 * * 1-5"), in the Mac's local time,
// the presets the popover offers on top of them, the next run times and a plain-English readback. No dependency:
// minute, hour, day of month, month and day of week, with *, lists, ranges and steps.

export type CronPreset = "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";

// What the popover's fields hold; cronFor turns it into a cron string and presetOf reads one back.
export interface CronPick {
  preset: CronPreset;
  hour: number;
  minute: number;
  // Days of the week for "weekly", 0 = Sunday.
  days: number[];
  // Day of the month for "monthly".
  dom: number;
  // The cron string itself for "custom".
  expr?: string;
}

interface Fields {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  // A * in day of month or day of week: cron matches either day field only when both are restricted.
  domAny: boolean;
  dowAny: boolean;
}

const RANGES: readonly (readonly [number, number])[] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
const NAMES = ["minute", "hour", "day of month", "month", "day of week"];

// One comma-separated part of a field ("*", "5", "1-5", "*/15", "10/5") as the values it runs from, to and by.
function partRange(part: string, [lo, hi]: readonly [number, number], name: string) {
  const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
  if (!m) throw new Error(`“${part}” isn't a valid ${name}.`);
  const step = m[4] ? Number(m[4]) : 1;
  const from = m[1] === "*" ? lo : Number(m[2]);
  // "10/5" runs from 10 to the end of the range; a bare "10" is just 10.
  const end = m[4] ? hi : from;
  const to = m[1] === "*" ? hi : m[3] !== undefined ? Number(m[3]) : end;
  if (step < 1 || from < lo || to > hi || from > to) throw new Error(`“${part}” is out of range for the ${name} (${lo}-${hi}).`);
  return { from, to, step };
}

function parseField(text: string, index: number): Set<number> {
  const range = RANGES[index] ?? [0, 0];
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const { from, to, step } = partRange(part, range, NAMES[index] ?? "field");
    for (let v = from; v <= to; v += step) out.add(index === 4 && v === 7 ? 0 : v);
  }
  return out;
}

// Throws an Error that says what's wrong, for the popover's Custom field and the MCP tool.
export function parseCron(expr: string): Fields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("A cron has five fields: minute hour day-of-month month day-of-week.");
  const [minute, hour, dom, month, dow] = parts.map(parseField) as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  return { minute, hour, dom, month, dow, domAny: parts[2] === "*", dowAny: parts[4] === "*" };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(f: Fields, d: Date): boolean {
  if (!f.month.has(d.getMonth() + 1)) return false;
  const dom = f.dom.has(d.getDate());
  const dow = f.dow.has(d.getDay());
  if (f.domAny && f.dowAny) return true;
  if (f.domAny) return dow;
  if (f.dowAny) return dom;
  return dom || dow;
}

// Five years of days: a cron like "0 0 30 2 *" never matches and gives undefined instead of spinning.
const MAX_DAYS = 366 * 5;

// The first time strictly after `after` (unix ms) the cron fires, in local time; undefined when it never does.
export function nextRun(expr: string, after: number): number | undefined {
  const f = parseCron(expr);
  const hours = [...f.hour].sort((a, b) => a - b);
  const minutes = [...f.minute].sort((a, b) => a - b);
  const start = new Date(after);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < MAX_DAYS; i++, day.setDate(day.getDate() + 1)) {
    if (!dayMatches(f, day)) continue;
    for (const h of hours) {
      for (const m of minutes) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
        if (at >= start.getTime()) return at;
      }
    }
  }
  return undefined;
}

// The next `count` run times after `after`, for the popover's "Next:" line and the calendar's dots.
export function nextRuns(expr: string, after: number, count: number): number[] {
  const out: number[] = [];
  let from = after;
  while (out.length < count) {
    const at = nextRun(expr, from);
    if (at === undefined) break;
    out.push(at);
    from = at;
  }
  return out;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function clock(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

function ordinal(n: number): string {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${tail}`;
}

function listDays(days: number[]): string {
  const names = days.map((d) => `${DAY_NAMES[d]}s`);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}` : names[0] ?? "";
}

// A cron string as the popover's fields, so editing a cron opens on the preset it was made with.
export function presetOf(expr: string): CronPick {
  const custom: CronPick = { preset: "custom", hour: 9, minute: 0, days: [1], dom: 1, expr };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5 || !isValidCron(expr)) return custom;
  const [mi, h, dom, mo, dow] = parts as [string, string, string, string, string];
  if (!/^\d+$/.test(mi) || mo !== "*") return custom;
  const minute = Number(mi);
  if (h === "*" && dom === "*" && dow === "*") return { ...custom, preset: "hourly", minute, expr: undefined };
  if (!/^\d+$/.test(h)) return custom;
  return timedPreset({ ...custom, hour: Number(h), minute, expr: undefined }, dom, dow, expr) ?? custom;
}

// A cron at a set time of day: daily, weekdays, weekly on some days or monthly on one day, or none of them.
function timedPreset(base: CronPick, dom: string, dow: string, expr: string): CronPick | undefined {
  if (dom === "*" && dow === "*") return { ...base, preset: "daily" };
  if (dom === "*" && dow === "1-5") return { ...base, preset: "weekdays", days: [1, 2, 3, 4, 5] };
  if (dom === "*" && /^\d(,\d)*$/.test(dow)) return { ...base, preset: "weekly", days: [...parseCron(expr).dow].sort() };
  if (/^\d+$/.test(dom) && dow === "*") return { ...base, preset: "monthly", dom: Number(dom) };
  return undefined;
}

// The popover's fields as a cron string.
export function cronFor(pick: CronPick): string {
  const { minute, hour } = pick;
  switch (pick.preset) {
    case "hourly": return `${minute} * * * *`;
    case "daily": return `${minute} ${hour} * * *`;
    case "weekdays": return `${minute} ${hour} * * 1-5`;
    case "weekly": return `${minute} ${hour} * * ${(pick.days.length ? [...pick.days].sort() : [1]).join(",")}`;
    case "monthly": return `${minute} ${hour} ${pick.dom} * *`;
    default: return (pick.expr ?? "").trim();
  }
}

// "weekdays at 9:00", "every hour at :15", "on the 1st of each month at 10:00"; anything else reads as its cron.
export function describeCron(expr: string): string {
  const p = presetOf(expr);
  const at = clock(p.hour, p.minute);
  switch (p.preset) {
    case "hourly": return `every hour at :${String(p.minute).padStart(2, "0")}`;
    case "daily": return `every day at ${at}`;
    case "weekdays": return `weekdays at ${at}`;
    case "weekly": return p.days.length === 7 ? `every day at ${at}` : `${listDays(p.days)} at ${at}`;
    case "monthly": return `on the ${ordinal(p.dom)} of each month at ${at}`;
    default: return `cron ${expr.trim()}`;
  }
}
