// The <weft-env> block: a few lines at the top of each message a board thread's CLI gets, saying which host runs the
// card, where the message came from and what time it is (docs/architecture/thread-env.md). The system prompt is fixed
// for a warm session, so per-turn facts ride on the turn. The thread shows the text you typed, not this: the runner
// adds it only to what goes to the CLI (lib/runner.ts sendMessage, lib/runner-steer.ts), and the transcript reader and
// the cloud rows strip it all the same (lib/transcript.ts, lib/card-rows.ts).
import { hostFacts, hostTz, type HostFacts } from "./host-facts";
import { describeClient, impliedClient, lastUserTz, takeClient, type TurnClient } from "./turn-client";
import { getCard } from "./store";
import { ENV_TAG } from "./env-block";

export { ENV_PROMPT, ENV_TAG, stripEnvBlock } from "./env-block";

const formats = new Map<string, Intl.DateTimeFormat>();

function formatIn(tz: string | undefined): Intl.DateTimeFormat {
  const key = tz ?? "";
  let f = formats.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" };
    f = new Intl.DateTimeFormat("en-US", tz ? { ...opts, timeZone: tz } : opts);
    formats.set(key, f);
  }
  return f;
}

function partsIn(now: Date, tz: string | undefined): { p: Record<string, string>; zone: string } {
  let f: Intl.DateTimeFormat;
  try {
    f = formatIn(tz);
  } catch {
    // A zone this runtime doesn't know (cleanTz checks the shape, not the name): the host's own.
    f = formatIn(undefined);
    tz = undefined;
  }
  return { p: Object.fromEntries(f.formatToParts(now).map((part) => [part.type, part.value])), zone: tz ?? f.resolvedOptions().timeZone };
}

/** "Mon 2026-11-02 17:23 Asia/Bangkok (UTC+07:00)" for an instant in a zone; without the day for date: false. */
export function clock(now: Date, tz: string | undefined, { date = true }: { date?: boolean } = {}): string {
  const { p, zone } = partsIn(now, tz);
  const offset = String(p.timeZoneName).replace("GMT", "UTC").replace(/^UTC$/, "UTC+00:00");
  const day = date ? `${p.weekday} ${p.year}-${p.month}-${p.day} ` : "";
  return `${day}${p.hour}:${p.minute} ${zone} (${offset})`;
}

// "14:02" in the host's zone, or "11-01 14:02" when it's most of a day old.
function shortTime(at: number, now: Date): string {
  const { p } = partsIn(new Date(at), undefined);
  return `${now.getTime() - at > 20 * 3600_000 ? `${p.month}-${p.day} ` : ""}${p.hour}:${p.minute}`;
}

function hostLine(f: HostFacts, now: Date): string {
  const who = f.worker ? `Weft Worker ${f.name}` : `your Mac (${f.name})`;
  const build = `Weft ${f.version}${f.commit ? ` @ ${f.commit}` : ""}`;
  let upstream = "";
  if (f.behind !== undefined) {
    const when = f.checkedAt ? ` as of ${shortTime(f.checkedAt, now)}` : "";
    upstream = f.behind ? `, ${f.behind} commit${f.behind === 1 ? "" : "s"} behind origin/main${when}` : `, up to date with origin/main${when}`;
  }
  return `host: ${who}, ${f.os}, ${build}${upstream}`;
}

function timeLine(now: Date, userTz: string | undefined, here: string): string {
  if (!userTz) return `time: host ${clock(now, here)}; the user's time zone isn't known yet`;
  if (userTz === here) return `time: ${clock(now, userTz)} (the user's and the host's)`;
  return `time: user ${clock(now, userTz)}; host ${clock(now, here, { date: false })}`;
}

export interface EnvInput {
  facts: HostFacts;
  client: TurnClient;
  now: Date;
  // The user's zone if a client reported one; a Mac falls back to its own, since you sit at it.
  userTz?: string;
  hostTz: string;
}

/** The block itself, three lines between the tags and a blank line after. */
export function envBlock({ facts, client, now, userTz, hostTz: here }: EnvInput): string {
  const tz = userTz ?? (facts.worker ? undefined : here);
  return `<${ENV_TAG}>\n${hostLine(facts, now)}\nfrom: ${describeClient(client)}\n${timeLine(now, tz, here)}\n</${ENV_TAG}>\n\n`;
}

/**
 * The block for the card's next message, taking its noted sender. Empty for a /command: Claude Code, puku, Codex and
 * Goose all read a skill from the start of the text, so nothing may go ahead of it (the next message carries the block).
 */
export function turnEnv(cardId: string, text: string, now: Date = new Date()): string {
  const noted = takeClient(cardId);
  if (text.startsWith("/")) return "";
  const card = getCard(cardId);
  const client = noted ?? impliedClient(card, card?.parentId ? getCard(card.parentId)?.title : undefined);
  return envBlock({ facts: hostFacts(), client, now, userTz: client.tz ?? lastUserTz(), hostTz: hostTz() });
}

/** The local routes' sender: the board in this Mac's window (it carries the launch token), else a thread's or script's call. */
export function deskClient(fromWindow: boolean): TurnClient {
  return fromWindow ? { app: "desktop", here: true, name: hostFacts().name, tz: hostTz() } : { app: "local" };
}
