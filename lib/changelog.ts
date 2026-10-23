import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { globalSingleton } from "./global-singleton";
import { DATA_DIR } from "./store";

// Every project's changelog, kept by Weft instead of a CHANGELOG.md every card edits at once: ~/.weft/changelog.jsonl,
// one JSON event per line, append-only. A thread adds an entry with mcp__board__changelog_add; the entry names the
// card that wrote it. When that card's commit lands the entry is stamped with the sha (draft → committed), and a
// release stamps its version (committed → released) and writes that version's section into the project's
// CHANGELOG.md, so the file has one writer, once per release (docs/architecture/changelog.md).

// A function, read at call time, so a module that only imports this one (board-tools via changelog-tool) loads under a
// test's ./store mock without DATA_DIR.
export const changelogFile = () => path.join(DATA_DIR, "changelog.jsonl");

// Keep a Changelog's sections, in the order a release lists them.
export const KINDS = ["added", "changed", "fixed", "removed", "security"] as const;
export type ChangeKind = (typeof KINDS)[number];

export interface ChangelogEntry {
  id: string;
  // The project's folder (its git root), the changelog it belongs to.
  project: string;
  kind: ChangeKind;
  text: string;
  at: number;
  // The card that wrote it; none for an entry imported from a CHANGELOG.md.
  cardId?: string;
  cardTitle?: string;
  sha?: string;
  committedAt?: number;
  version?: string;
  releasedAt?: number;
}

export type EntryStatus = "draft" | "committed" | "released";

export type ChangelogEvent =
  | ({ t: "add" } & ChangelogEntry)
  | { t: "edit"; id: string; at: number; text?: string; kind?: ChangeKind }
  | { t: "remove"; id: string; at: number }
  | { t: "stamp"; ids: string[]; sha: string; at: number }
  | { t: "release"; ids: string[]; version: string; at: number };

export const isKind = (value: unknown): value is ChangeKind => KINDS.includes(value as ChangeKind);

export const statusOf = (entry: ChangelogEntry): EntryStatus =>
  entry.version ? "released" : entry.sha ? "committed" : "draft";

// Every event in order; a torn last line (a crash mid-append) is skipped, not fatal.
export function readEvents(file = changelogFile()): ChangelogEvent[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as ChangelogEvent];
    } catch {
      return [];
    }
  });
}

// An add event's entry, without the event's tag.
export function entryOf(event: Extract<ChangelogEvent, { t: "add" }>): ChangelogEntry {
  const entry: ChangelogEntry & { t?: string } = { ...event };
  delete entry.t;
  return entry;
}

// Sets `patch` on each of `ids` that doesn't have `key` yet: a stamp or release never overwrites an earlier one.
function mark(byId: Map<string, ChangelogEntry>, ids: string[], key: "sha" | "version", patch: Partial<ChangelogEntry>) {
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry && !entry[key]) byId.set(id, { ...entry, ...patch });
  }
}

function apply(byId: Map<string, ChangelogEntry>, event: ChangelogEvent) {
  switch (event.t) {
    case "add":
      byId.set(event.id, entryOf(event));
      return;
    case "edit": {
      const entry = byId.get(event.id);
      if (entry) byId.set(event.id, { ...entry, ...(event.text ? { text: event.text } : {}), ...(event.kind ? { kind: event.kind } : {}) });
      return;
    }
    case "remove":
      byId.delete(event.id);
      return;
    case "stamp":
      mark(byId, event.ids, "sha", { sha: event.sha, committedAt: event.at });
      return;
    case "release":
      mark(byId, event.ids, "version", { version: event.version, releasedAt: event.at });
  }
}

// The events folded into the entries they leave, oldest first. A removed entry is gone, and a later commit of the
// same card can't move an entry that already shipped.
export function fold(events: ChangelogEvent[]): ChangelogEntry[] {
  const byId = new Map<string, ChangelogEntry>();
  for (const event of events) apply(byId, event);
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

// Listeners told about each appended event: the cloud mirror (lib/changelog-sync.ts) uploads what changed. On
// globalThis, since the tool's route and the server's prewarm can load this module in different bundles.
const listeners = () => globalSingleton("__weftChangelogListeners", () => new Set<(event: ChangelogEvent) => void>());
export function onChangelogEvent(listener: (event: ChangelogEvent) => void) {
  listeners().add(listener);
  return () => listeners().delete(listener);
}

export function appendEvent(event: ChangelogEvent, file = changelogFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
  for (const listener of listeners()) {
    try {
      listener(event);
    } catch (err) {
      console.warn("changelog listener failed", err);
    }
  }
}

export const readChangelog = (file = changelogFile()) => fold(readEvents(file));

export const entriesFor = (project: string, file = changelogFile()) => readChangelog(file).filter((e) => e.project === project);

export interface NewEntry {
  project: string;
  kind: ChangeKind;
  text: string;
  cardId?: string;
  cardTitle?: string;
  at?: number;
}

export function addEntry(input: NewEntry, file = changelogFile()): ChangelogEntry {
  const text = input.text.trim();
  if (!text) throw new Error("A changelog entry needs text.");
  if (!isKind(input.kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}.`);
  const entry: ChangelogEntry = {
    id: randomUUID(),
    project: input.project,
    kind: input.kind,
    text,
    at: input.at ?? Date.now(),
    ...(input.cardId ? { cardId: input.cardId } : {}),
    ...(input.cardTitle ? { cardTitle: input.cardTitle } : {}),
  };
  appendEvent({ t: "add", ...entry }, file);
  return entry;
}

// Rewords or recategorises an entry that hasn't been released; a released one is history.
export function editEntry(id: string, patch: { text?: string; kind?: ChangeKind }, file = changelogFile()): ChangelogEntry {
  const entry = readChangelog(file).find((e) => e.id === id);
  if (!entry) throw new Error(`No changelog entry ${id}.`);
  if (entry.version) throw new Error(`That entry shipped in ${entry.version}; add a new one instead.`);
  if (patch.kind && !isKind(patch.kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}.`);
  const text = patch.text?.trim() || undefined;
  appendEvent({ t: "edit", id, at: Date.now(), ...(text ? { text } : {}), ...(patch.kind ? { kind: patch.kind } : {}) }, file);
  return { ...entry, ...(text ? { text } : {}), ...(patch.kind ? { kind: patch.kind } : {}) };
}

export function removeEntry(id: string, file = changelogFile()) {
  const entry = readChangelog(file).find((e) => e.id === id);
  if (!entry) throw new Error(`No changelog entry ${id}.`);
  if (entry.version) throw new Error(`That entry shipped in ${entry.version}; it stays in the history.`);
  appendEvent({ t: "remove", id, at: Date.now() }, file);
}

// A card's commit landed in a project: its entries there that had no commit yet get this sha. Returns how many.
export function stampCard(cardId: string, project: string, sha: string, file = changelogFile()): number {
  const ids = readChangelog(file)
    .filter((e) => e.cardId === cardId && e.project === project && !e.sha && !e.version)
    .map((e) => e.id);
  if (ids.length) appendEvent({ t: "stamp", ids, sha, at: Date.now() }, file);
  return ids.length;
}

// Every unreleased entry of a project goes into `version`. By hand (`pnpm changelog:release`) drafts go too, since a
// release ships the tree and the caller warns about them; the background write (lib/changelog-write.ts) takes only
// committed ones, since a draft isn't in the commit yet.
export function releaseProject(project: string, version: string, file = changelogFile(), { committedOnly = false } = {}): ChangelogEntry[] {
  const at = Date.now();
  const entries = entriesFor(project, file).filter((e) => !e.version && (!committedOnly || e.sha));
  if (entries.length) appendEvent({ t: "release", ids: entries.map((e) => e.id), version, at }, file);
  return entries.map((e) => ({ ...e, version, releasedAt: at }));
}

// Every text a project's entries ever had (adds and edits, removed ones too), so the background write can tell the
// lines it wrote into CHANGELOG.md from ones typed by hand.
export function textsFor(project: string, file = changelogFile()): Set<string> {
  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const event of readEvents(file)) {
    if (event.t === "add" && event.project === project) {
      ids.add(event.id);
      texts.add(event.text);
    } else if (event.t === "edit" && event.text && ids.has(event.id)) texts.add(event.text);
  }
  return texts;
}
