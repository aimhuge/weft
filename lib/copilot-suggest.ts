import { subscribe } from "./bus";
import { cardLines, clock, overlaps, recentDone, spend } from "./copilot-context";
import { SEED_SOURCE, SETUP_SOURCE } from "./copilot-setup";
import { basename } from "node:path";
import { activeProjects, gatherSections, safeRoot, SOURCES, type Section } from "./copilot-sources";
import { STARTERS } from "./copilot-starters";
import { complete } from "./haiku";
import { listCards } from "./store";
import type { Card } from "./types";

// The copilot's board-made chips: Haiku reads what Weft knows about your work (the open cards in full, lib/copilot-context.ts;
// cached reads and outside services, lib/copilot-sources.ts) and suggests a few things to ask, most urgent first. The empty
// chat shows them above the fixed starters (components/CopilotEmpty.tsx), and hides a starter a chip already covers.
// Each chip names its project, so one run serves every project chip on the board: switching projects only filters.
// A run takes ~10-20s, so it is kept until the board changes, refreshed in the background after a move, and at most
// SUGGEST_TTL old.

export const MAX_SUGGESTIONS = 4;
const PER_PROJECT = 3;
const MAX_CHARS = 90;
const SUGGEST_TTL = 15 * 60_000;
const REFRESH_DELAY = 20_000;

// project: the repo root it is about (the board's project path); none for an account-wide chip, shown in every project.
export type Chip = { text: string; cardId?: string; project?: string; covers?: string[] };
export type Suggestions = { chips: Chip[]; covers: string[] };
const NONE: Suggestions = { chips: [], covers: [] };

type Brief = Pick<Card, "id" | "column" | "error" | "archived" | "role">;
const open = <T extends Brief>(cards: readonly T[]) => cards.filter((c) => c.role !== "copilot" && !c.archived && c.column !== "done");

// What the cache is keyed on: the open cards and their columns, so a new card or a move refreshes it.
export const boardKey = (cards: readonly Brief[]) =>
  open(cards)
    .map((c) => `${c.id}:${c.column}${c.error ? "!" : ""}`)
    .sort()
    .join(",");

const block = (title: string, lines: readonly string[]) => (lines.length ? `## ${title}\n${lines.join("\n")}` : "");

// Everything Haiku reads, as titled blocks; empty ones left out.
export function contextText(cards: readonly Card[], sections: readonly Section[], now: number): string {
  return [
    `Now: ${clock(now)}`,
    block("Open cards, most urgent first", cardLines(cards, now)),
    block("Finished in the last day", recentDone(cards, now)),
    block("Open cards editing the same file", overlaps(cards)),
    block("Spend and plan limits", spend(cards, now)),
    ...sections.map((s) => block(s.title, s.lines)),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function suggestPrompt(context: string, projects: readonly string[] = []) {
  const count = projects.length > 1 ? `up to ${String(PER_PROJECT)} for each project (${projects.join(", ")}), all in one list,` : String(MAX_SUGGESTIONS);
  return `You are the copilot of Weft, a kanban board where each card is an AI coding thread. Columns: backlog, running, needs_you (waiting on the user), review (finished, the user should check), done.
Suggest ${count} things the user could ask you right now, specific to the facts below, most urgent first:
1. a card waiting on the user (oldest first), 2. an errored or rate-limited card, 3. finished work to review or commit,
4. a failed deploy, unapplied migration, blank secret or unregistered webhook blocking something, 5. the next useful step
(a refactor scout finding, a backlog card, an open PR or issue, keeping the streak, wrapping up late at night).
Rules:
- Write each as the user would type it, under ${String(MAX_CHARS)} characters, no emoji.
- Name the card or project, and the concrete thing: numbers, file names, the error.
- When a chip answers a question, spell out what the chosen option means, never a bare label: write
  "Pick Option A, GitHub only, for the auth card", not "Pick Option A for the auth card".
- Only state facts given below. Don't repeat what the user recently asked or ignored.
- When "Not set up yet" lists something that would help with the board's work, make one chip offering to link it, naming
  what it unlocks: "Link weft to Vercel so I can watch its deploys", "Add analytics to weft so I can count its users".
- Give each chip the project it is about, by name; leave it out only for an account-wide one (a sign-in, the plan's limits).
For each chip, also list which of these fixed starters it makes redundant: ${JSON.stringify(STARTERS)}.
Reply with only JSON: {"chips": [{"text": "...", "cardId": "<id of the card it is about, if one>", "project": "<project name>", "covers": ["<starter>"]}]}

${context}`;
}

const clean = (s: unknown) => (typeof s === "string" ? s.trim() : "");

type Known = { ids?: ReadonlySet<string>; cardProject?: ReadonlyMap<string, string>; projects?: ReadonlyMap<string, string> };

const startersIn = (raw: unknown) => {
  const starters = new Set<string>(STARTERS);
  return [...new Set((Array.isArray(raw) ? raw : []).map(clean).filter((s) => starters.has(s)))];
};

// Haiku's reply: the JSON object in it, chips trimmed, short and deduplicated, covers limited to real starters. A chip's
// project comes from its card when it names one, else from the project name Haiku gave (projects: name → root).
export function parseSuggestions(text: string, known: Known | ReadonlySet<string> = {}): Suggestions {
  const k: Known = known instanceof Set ? { ids: known } : (known as Known);
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return NONE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return NONE;
  }
  const { chips: rawChips, covers: rawCovers } = (parsed ?? {}) as { chips?: unknown; covers?: unknown };
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const raw of Array.isArray(rawChips) ? rawChips : []) {
    const chip = parseChip(raw, k);
    if (!chip || seen.has(chip.text)) continue;
    seen.add(chip.text);
    chips.push(chip);
  }
  const limit = Math.max(MAX_SUGGESTIONS, (k.projects?.size ?? 0) * PER_PROJECT);
  const kept = chips.slice(0, limit);
  return { chips: kept, covers: [...new Set([...startersIn(rawCovers), ...kept.flatMap((c) => c.covers ?? [])])] };
}

// One chip from the reply, or null when it has no usable text.
function parseChip(raw: unknown, { ids, cardProject, projects }: Known): Chip | null {
  const item = (typeof raw === "string" ? { text: raw } : (raw ?? {})) as { text?: unknown; cardId?: unknown; project?: unknown; covers?: unknown };
  const text = clean(item.text);
  if (!text || text.length > MAX_CHARS * 1.5) return null;
  const cardId = clean(item.cardId);
  const chip: Chip = ids?.has(cardId) ? { text, cardId } : { text };
  const project = (chip.cardId && cardProject?.get(chip.cardId)) || projects?.get(clean(item.project));
  if (project) chip.project = project;
  const covers = startersIn(item.covers);
  if (covers.length) chip.covers = covers;
  return chip;
}

type Deps = { ask?: (prompt: string) => Promise<string>; gather?: (cards: readonly Card[]) => Promise<Section[]>; now?: () => number };

// Every source, the setup checks and starter cards included.
const gatherAll = (cards: readonly Card[]) => gatherSections(cards, [...SOURCES, SETUP_SOURCE, SEED_SOURCE]);

// Exactly what Haiku would read for this board now (GET /api/copilot/suggestions?context=1).
export async function boardContext(cards: readonly Card[], deps: Deps = {}): Promise<string> {
  const { gather = gatherAll, now = Date.now } = deps;
  return contextText(cards, await gather(cards), now());
}

// The last answer and the run in flight, kept for the life of the server.
const g = globalThis as unknown as {
  __weftCopilotSuggest?: { key: string; at: number; result: Promise<Suggestions>; chips?: Chip[] };
  __weftSuggestRefresh?: () => void;
};

// This board's chips: the cached ones while the board is unchanged and fresh, else a new run. An empty board needs no
// run; a failed one gives none and is retried on the next ask.
export function boardSuggestions(cards: readonly Card[], deps: Deps = {}): Promise<Suggestions> {
  const { ask = complete, gather = gatherAll, now = Date.now } = deps;
  if (!open(cards).length) return Promise.resolve(NONE);
  const key = boardKey(cards);
  const cached = g.__weftCopilotSuggest;
  if (cached?.key === key && now() - cached.at < SUGGEST_TTL) return cached.result;
  const roots = activeProjects(cards);
  const projects = new Map(roots.map((r) => [basename(r), r]));
  const known: Known = { ids: new Set(cards.map((c) => c.id)), cardProject: new Map(open(cards).map((c) => [c.id, safeRoot(c.cwd)])), projects };
  const result = gather(cards)
    .then((sections) => ask(suggestPrompt(contextText(cards, sections, now()), [...projects.keys()])))
    .then((reply) => parseSuggestions(reply, known))
    .catch(() => NONE);
  const entry: { key: string; at: number; result: Promise<Suggestions>; chips?: Chip[] } = { key, at: now(), result };
  g.__weftCopilotSuggest = entry;
  void result.then((r) => {
    entry.chips = r.chips;
    if (!r.chips.length && g.__weftCopilotSuggest === entry) g.__weftCopilotSuggest = undefined;
  });
  return result;
}

export const forgetSuggestions = () => void (g.__weftCopilotSuggest = undefined);

// The card a chip you just sent is about, when it was one of the latest chips (lib/copilot.ts tells the copilot).
export const chipCardId = (text: string) => g.__weftCopilotSuggest?.chips?.find((c) => c.text === text.trim())?.cardId;

// Once per server (from prewarm()): after a card moves, wait for the board to settle, then make fresh chips so they are
// ready when you open a new chat. Only a move, a new card or an error changes the key, so streaming text costs nothing.
export function startSuggestRefresh(deps: Deps & { cards?: () => Card[]; delay?: number } = {}) {
  if (g.__weftSuggestRefresh) return g.__weftSuggestRefresh;
  const { cards = listCards, delay = REFRESH_DELAY } = deps;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = subscribe((event) => {
    if (event.type !== "card" && event.type !== "card_deleted") return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = cards();
      if (g.__weftCopilotSuggest?.key !== boardKey(list)) void boardSuggestions(list, deps);
    }, delay);
  });
  g.__weftSuggestRefresh = () => {
    clearTimeout(timer);
    unsubscribe();
    g.__weftSuggestRefresh = undefined;
  };
  return g.__weftSuggestRefresh;
}
