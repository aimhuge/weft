import { ANTIGRAVITY_STATUS_ARGS, antigravityBin, jsonIn } from "./antigravity-login";
import { runCliText } from "./cli-exec";
import { cliEnv } from "./env";
import { recordLimits } from "./limit-history";
import type { LimitWindow } from "./types";

// Antigravity's quota on the plan-limits strip.
//
// `agy -p /usage --output-format json` is free (no model call) and, signed in, answers the account's quota as data:
// `command.data.groups[]`, each a set of models sharing `buckets[]` ({ window: "weekly" | "5h", remaining_fraction,
// reset_time }). A free account had a "Gemini Models" group with a weekly bucket and a "Claude and GPT models" group with
// a weekly and a 5-hour one. A reset_time of 1970-01-01 means the window hasn't started: nothing used, no reset yet.
//
// The strip shows one 5-hour and one weekly window per CLI (lib/plan-limits.ts), so each window is the tightest bucket
// of that length across the groups: the one that runs out first is the one that stops a thread. lib/limit-poll.ts asks
// on its own 15-minute tick and records the reading under "antigravity" (lib/limit-history.ts).

export interface AgyBucket {
  group: string;
  id: string;
  window: string;
  // Percent used, 0-100: 1 - remaining_fraction.
  used: number;
  // Unix seconds; absent while the window hasn't started.
  resetsAt?: number;
}

export interface AgyLimits {
  fiveHour?: LimitWindow;
  sevenDay?: LimitWindow;
}

// How long one `agy -p /usage` may take; it answered in about four seconds.
export const USAGE_TIMEOUT_MS = 30_000;

const asList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null) : [];

const str = (value: unknown): string => (typeof value === "string" ? value : "");

// A reset time in unix seconds, or undefined for 1970 ("not started") or anything unreadable.
function resetOf(value: unknown): number | undefined {
  const ms = Date.parse(str(value));
  return ms > 0 ? ms / 1000 : undefined;
}

/** Every quota bucket in agy's /usage JSON, flattened across its groups; empty when the output holds none. */
export function parseAgyBuckets(stdout: string): AgyBucket[] {
  const data = jsonIn(stdout);
  if (data?.status !== "SUCCESS") return [];
  const command = data.command as { data?: { groups?: unknown } } | undefined;
  return asList(command?.data?.groups).flatMap((group) =>
    asList(group.buckets).flatMap((bucket): AgyBucket[] => {
      const left = bucket.remaining_fraction;
      if (typeof left !== "number" || !Number.isFinite(left)) return [];
      const resetsAt = resetOf(bucket.reset_time);
      const used = Math.round((1 - Math.min(1, Math.max(0, left))) * 100);
      return [{ group: str(group.name), id: str(bucket.id), window: str(bucket.window), used, ...(resetsAt !== undefined && { resetsAt }) }];
    }),
  );
}

// The tighter of two buckets: the more used, or at a tie the one whose window has started (it has a reset to show).
function tighter(a: AgyBucket | undefined, b: AgyBucket): AgyBucket {
  if (!a) return b;
  if (b.used !== a.used) return b.used > a.used ? b : a;
  return a.resetsAt === undefined && b.resetsAt !== undefined ? b : a;
}

const windowOf = (b: AgyBucket): LimitWindow => ({ used: b.used, ...(b.resetsAt !== undefined && { resetsAt: b.resetsAt }) });

/** The strip's two windows from agy's buckets: the tightest 5-hour one and the tightest weekly one. */
export function agyLimits(buckets: AgyBucket[]): AgyLimits {
  let five: AgyBucket | undefined;
  let week: AgyBucket | undefined;
  for (const b of buckets) {
    if (b.window === "5h") five = tighter(five, b);
    else if (b.window === "weekly") week = tighter(week, b);
  }
  return { ...(five && { fiveHour: windowOf(five) }), ...(week && { sevenDay: windowOf(week) }) };
}

export interface UsageDeps {
  bin: () => string | null;
  run: (bin: string, args: string[]) => Promise<string>;
  record: (backend: "antigravity", limits: AgyLimits, now: number) => void;
}

const DEPS: UsageDeps = {
  bin: () => antigravityBin(),
  run: (bin, args) => runCliText(bin, args, { timeout: USAGE_TIMEOUT_MS, env: cliEnv(), maxBuffer: 1024 * 1024 }),
  record: (backend, limits, now) => {
    recordLimits(backend, limits, now);
  },
};

/**
 * Asks agy for the account's quota and records it for the strip. Nothing when agy isn't installed, isn't signed in or
 * says nothing readable; never throws. Whether it recorded a reading.
 */
export async function pollAntigravityUsage(now = Date.now(), deps: UsageDeps = DEPS): Promise<boolean> {
  const bin = deps.bin();
  if (!bin) return false;
  try {
    const limits = agyLimits(parseAgyBuckets(await deps.run(bin, ANTIGRAVITY_STATUS_ARGS)));
    if (!limits.fiveHour && !limits.sevenDay) return false;
    deps.record("antigravity", limits, now);
    return true;
  } catch {
    // Signed out, `agy -p /usage` exits non-zero with "authentication required": there is no quota to show.
    return false;
  }
}
