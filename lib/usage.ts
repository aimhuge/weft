// Token usage and plan-limit hits, for the wefter card's chart and the limit badges. Pure: reading a
// transcript line, telling a 5-hour hit from a weekly one, and folding hits and days into the chart.
// lib/usage-scan.ts reads the transcripts; lib/activity.ts logs the hits a Weft thread sees live.
import { addDays, dayKey } from "./game";

export type LimitKind = "five_hour" | "seven_day";

export const WINDOW_MS: Record<LimitKind, number> = { five_hour: 5 * 60 * 60 * 1000, seven_day: 7 * 24 * 60 * 60 * 1000 };

// One limit hit: when, which window, and the reset it named ("4:10am", an epoch), to tell windows apart.
export interface LimitHit {
  at: number;
  kind: LimitKind;
  reset?: string;
  // When the window resets, in ms, when a live thread was told (lib/runner-turn.ts).
  resetAt?: number;
}

// A day's tokens: what went in (fresh input and cache writes, not cache reads) and what came out.
export type DayTokens = [input: number, output: number];

// Which window a limit message is about. "session limit" and "5-hour" are the 5-hour one; "weekly",
// an Opus or Sonnet cap, or a reset with a date ("resets Oct 20, 9pm") or more than 5 hours away is weekly.
export function limitKind(text: string, at: number): LimitKind {
  if (/week|7.day|seven.day|opus limit|sonnet limit/i.test(text)) return "seven_day";
  if (/session limit|5.hour|five.hour/i.test(text)) return "five_hour";
  if (/resets? (?:on )?[A-Z][a-z]{2,8} \d/.test(text)) return "seven_day";
  const epoch = Number(/\|(\d{10})\b/.exec(text)?.[1] ?? 0);
  return epoch && epoch * 1000 - at > WINDOW_MS.five_hour ? "seven_day" : "five_hour";
}

// The reset a limit message names: "4:10am (Asia/Bangkok)" or the epoch after "|".
export function resetOf(text: string): string | undefined {
  const named = /resets? (?:at |on )?([^·\n"]+?)\s*$/i.exec(text)?.[1] ?? /\|(\d{10})\b/.exec(text)?.[1];
  return named?.trim() || undefined;
}

// A plan limit, not a transient 429 ("API Error: Rate limit reached" is the API's, and passes).
const PLAN_LIMIT = /hit your (?:[\w-]+ )?limit|usage limit|(?:session|weekly|5-hour|opus|sonnet) limit reached/i;

export function hitFrom(text: string, at: number): LimitHit | null {
  if (!PLAN_LIMIT.test(text)) return null;
  const reset = resetOf(text);
  return { at, kind: limitKind(text, at), ...(reset && { reset }) };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
// A transcript field that should be a string or number, as text ("" for anything else).
const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

// The text of an API error the CLI wrote as an assistant message, joined from its blocks.
function errorText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content.map((b: { text?: unknown } | null) => (typeof b?.text === "string" ? b.text : "")).join(" ");
}

export type LineUsage =
  | { type: "tokens"; at: number; key: string; input: number; output: number }
  | { type: "hit"; hit: LimitHit };

// What one Claude Code (or puku-cli) transcript line adds: a request's tokens, keyed by its request id
// (the CLI writes one line per content block, all with the same usage), or a limit hit the CLI reported.
export function readLine(line: string): LineUsage | null {
  if (!line.includes('"assistant"')) return null;
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const msg = row.message as { id?: string; model?: string; usage?: Record<string, unknown>; content?: unknown } | undefined;
  const at = Date.parse(str(row.timestamp));
  if (row.type !== "assistant" || !msg || Number.isNaN(at)) return null;
  if (row.isApiErrorMessage) {
    const hit = hitFrom(errorText(msg.content), at);
    return hit && { type: "hit", hit };
  }
  const u = msg.usage;
  if (!u || msg.model === "<synthetic>") return null;
  const input = num(u.input_tokens) + num(u.cache_creation_input_tokens);
  const output = num(u.output_tokens);
  if (!input && !output) return null;
  return { type: "tokens", at, key: str(row.requestId) || msg.id || str(row.uuid) || String(at), input, output };
}

// Hits of one window that are really one: within the window's length of the first, naming the same
// reset (or one of them naming none). Parallel threads all hit the same window; this counts it once.
export function distinctHits(hits: LimitHit[]): LimitHit[] {
  const out: LimitHit[] = [];
  for (const hit of [...hits].sort((a, b) => a.at - b.at)) {
    const same = out.findLast((h) => h.kind === hit.kind);
    const joined = same && hit.at - same.at < WINDOW_MS[hit.kind] && (!same.reset || !hit.reset || same.reset === hit.reset);
    if (!joined) out.push({ ...hit });
    // A live thread's exact reset beats the transcript's rounded one, whichever came first.
    else if (hit.resetAt !== undefined) same.resetAt ??= hit.resetAt;
  }
  return out;
}

export interface UsageDay {
  day: string;
  input: number;
  output: number;
  fiveHour: number;
  sevenDay: number;
}

// The chart's last `n` days, oldest first, ending today.
export function usageDays(tokens: Map<string, DayTokens>, hits: LimitHit[], today: string, n = 30): UsageDay[] {
  const counted = new Map<string, { fiveHour: number; sevenDay: number }>();
  for (const hit of hits) {
    const day = dayKey(hit.at);
    const c = counted.get(day) ?? { fiveHour: 0, sevenDay: 0 };
    if (hit.kind === "five_hour") c.fiveHour += 1;
    else c.sevenDay += 1;
    counted.set(day, c);
  }
  const out: UsageDay[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const [input, output] = tokens.get(day) ?? [0, 0];
    out.push({ day, input, output, fiveHour: 0, sevenDay: 0, ...counted.get(day) });
  }
  return out;
}

// "1.2M", "340K", "900".
export function shortTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
