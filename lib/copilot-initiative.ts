import { basename } from "node:path";
import type { ThreadItem } from "./types";

// When the copilot speaks first. It isn't a status feed (the swim lanes are): Weft starts a copilot turn, a
// "check-in", at a few moments worth a thought, and the copilot brings one idea or says QUIET. Two kinds:
//   morning: once a day, when you're at work: what to build next, from the projects and their analytics.
//   landed:  work just landed in a project (its HEAD moved and settled): the refactor worth doing now.
// The rules here are pure; lib/copilot-initiative-run.ts keeps the clock, reads git and sends the turn.

export type CheckInKind = "morning" | "landed";

// What Weft remembers between ticks, in ~/.weft/copilot-initiative.json.
export interface InitiativeState {
  // The local day (YYYY-MM-DD) the count is for, and how many check-ins went out that day.
  day: string;
  count: number;
  // When the last check-in went out (ms), and the day the morning one did.
  lastAt: number;
  morningDay?: string;
  // Each project's HEAD at the last landed check-in (or when Weft first saw it), and a moved HEAD waiting to settle.
  heads: Record<string, string>;
  moved: Record<string, { head: string; at: number }>;
  // You turned check-ins off in the copilot's menu.
  off?: boolean;
}

export const EMPTY_STATE: InitiativeState = { day: "", count: 0, lastAt: 0, heads: {}, moved: {} };

export const MAX_PER_DAY = 3;
export const MIN_GAP_MS = 2 * 60 * 60_000;
// The copilot keeps quiet from 21:00 to 7:00 local time.
export const WAKE_HOUR = 7;
export const SLEEP_HOUR = 21;
// A moved HEAD waits this long without moving again, so a burst of commits is one check-in.
export const SETTLE_MS = 10 * 60_000;
// You count as at work when a card did something this recently.
export const AROUND_MS = 60 * 60_000;

const pad = (n: number) => String(n).padStart(2, "0");
export const localDay = (now: Date) => `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// The day's count, reset when the day turns.
export const today = (s: InitiativeState, now: Date): InitiativeState => (s.day === localDay(now) ? s : { ...s, day: localDay(now), count: 0 });

// Why no check-in may go out now, or null when one may.
export function blocked(s: InitiativeState, now: Date, copilot: { busy: boolean; items: ThreadItem[] }): string | null {
  const hour = now.getHours();
  if (hour < WAKE_HOUR || hour >= SLEEP_HOUR) return "quiet hours";
  if (today(s, now).count >= MAX_PER_DAY) return "daily cap";
  if (now.getTime() - s.lastAt < MIN_GAP_MS) return "too soon";
  if (copilot.busy) return "copilot busy";
  if (waitingIdea(copilot.items)) return "an idea is still waiting";
  return null;
}

// The last thing in the copilot's thread is a check-in you haven't answered: one waits at a time, never a stack.
export function waitingIdea(items: ThreadItem[]): boolean {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "user") return isCheckIn(item.text);
  }
  return false;
}

// The thread shows a short line for a check-in; the CLI gets the full ask (checkInText).
export const CHECK_IN_LABEL = { morning: "☀️ Morning check-in", landed: "🔧 Refactor check-in" } as const;
export const isCheckIn = (text: string) => Object.values(CHECK_IN_LABEL).some((label) => text.startsWith(label));

export const shownText = (kind: CheckInKind, root?: string) => (root ? `${CHECK_IN_LABEL[kind]}: ${basename(root)}` : CHECK_IN_LABEL[kind]);

const RULES = `Bring at most one idea worth the user's time, in two or three sentences, ending with the step you'd take (usually a card you'd make). Don't open anything in the browser pane, and don't start, stop or message any card: the user decides. When nothing clears the bar, reply with exactly QUIET.`;

// What the copilot's CLI gets for the morning check-in.
export function morningText(projects: string[]): string {
  return `[Weft check-in: morning, not written by the user] The user is starting their day. Projects: ${projects.length ? projects.join(", ") : "the projects on the board"}.
Look at what the projects say about themselves (roadmap, recent commits, open issues) and, if you can read their analytics (PostHog, GA4 or the like), at what users did lately. What's the one thing you'd build or fix next, and why?
${RULES}`;
}

// What the copilot's CLI gets when work landed in a project: its commits, and the refactor scout's open findings there.
export function landedText(root: string, commits: string[], scout: string[]): string {
  const findings = scout.length ? `\nRefactor scout findings still open there:\n${scout.join("\n")}` : "";
  return `[Weft check-in: work landed, not written by the user] These commits just landed in ${root}:
${commits.join("\n")}${findings}
Look at the code these commits touched. Is there one refactor worth doing now: a smell the new code made worse, a file at its size cap, logic now duplicated? Name it, say why now, and offer the card.
${RULES}`;
}

// Commits worth a refactor look: anything but changelog, release and merge bookkeeping.
const BOOKKEEPING = /^(docs\(changelog\)|chore\(release\)|chore\(migrations\)|Merge |wip:)/;
export const worthALook = (subjects: string[]) => subjects.filter((s) => !BOOKKEEPING.test(s));

// The project whose HEAD has moved and settled, and the HEAD it settled on; heads Weft hasn't seen before are only recorded.
const without = <T>(map: Record<string, T>, key: string) => Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));

export type Landed = { root: string; from: string; head: string };

export function settledMove(s: InitiativeState, heads: Record<string, string>, now: number): { state: InitiativeState; landed?: Landed } {
  const known = { ...s.heads };
  let moved = { ...s.moved };
  let landed: Landed | undefined;
  for (const [root, head] of Object.entries(heads)) {
    const was = known[root];
    if (!was) {
      known[root] = head;
      continue;
    }
    if (was === head) {
      moved = without(moved, root);
      continue;
    }
    const pending = moved[root];
    if (pending?.head !== head) moved[root] = { head, at: now };
    else if (!landed && now - pending.at >= SETTLE_MS) landed = { root, from: was, head };
  }
  return { state: { ...s, heads: known, moved }, landed };
}

// After a check-in for a project goes out (or is passed over), its HEAD is the new baseline.
export function markLanded(s: InitiativeState, root: string, head: string): InitiativeState {
  return { ...s, heads: { ...s.heads, [root]: head }, moved: without(s.moved, root) };
}

// A check-in went out.
export function counted(s: InitiativeState, now: Date, kind: CheckInKind): InitiativeState {
  const t = today(s, now);
  return { ...t, count: t.count + 1, lastAt: now.getTime(), ...(kind === "morning" ? { morningDay: localDay(now) } : {}) };
}

// The morning check-in is due: none yet today, and you're at work.
export const morningDue = (s: InitiativeState, now: Date, lastActivity: number) =>
  s.morningDay !== localDay(now) && now.getTime() - lastActivity < AROUND_MS;
