import fs from "node:fs";
import path from "node:path";
import { parseNote, serializeNote, today, type SiteNote } from "./site-notes-format";
import { pathSlug } from "./site-notes-url";
import { DATA_DIR } from "./store";

// The local tier of site notes (docs/architecture/site-notes.md#local): one Markdown file per host and general
// path under ~/.weft/site-notes/<host>/, the public-sharing switch, and the outbox of notes waiting for the user
// to send them to everyone. Nothing here talks to the network.

export const NOTES_DIR = path.join(DATA_DIR, "site-notes");

const VALID_HOST = /^[a-z0-9.-]{1,253}$/;
const VALID_PATH = /^\/[a-z0-9:_.~/-]{0,299}$/i;

export const validKey = (host: string, notePath: string) => VALID_HOST.test(host) && !host.includes("..") && VALID_PATH.test(notePath);

const noteFile = (dir: string, host: string, notePath: string) => path.join(dir, host, `${pathSlug(notePath)}.md`);

export function readHostNotes(host: string, dir = NOTES_DIR): SiteNote[] {
  if (!VALID_HOST.test(host) || host.includes("..")) return [];
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ path.join(dir, host)).filter((n) => n.endsWith(".md"));
  } catch {
    return [];
  }
  const notes: SiteNote[] = [];
  for (const name of names.sort()) {
    const note = parseNote(fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, host, name), "utf8"));
    if (note?.host === host) notes.push(note);
  }
  return notes;
}

export function readNote(host: string, notePath: string, dir = NOTES_DIR): SiteNote | null {
  return readHostNotes(host, dir).find((n) => n.path === notePath) ?? null;
}

export function writeNote(note: Pick<SiteNote, "host" | "path" | "body"> & Partial<SiteNote>, dir = NOTES_DIR): string {
  if (!validKey(note.host, note.path)) throw new Error(`Not a note key: ${note.host} ${note.path}`);
  const file = noteFile(dir, note.host, note.path);
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ file, serializeNote({ updated: today(), ...note }));
  return file;
}

// A card's flow with a local note worked (stamp lastSuccess, clear stale) or a step failed (mark it stale).
export function markLocalOutcome(host: string, notePath: string, outcome: "success" | "failure", dir = NOTES_DIR, now = new Date()) {
  const note = readNote(host, notePath, dir);
  if (!note) return;
  if (outcome === "success") writeNote({ ...note, lastSuccess: today(now), stale: false }, dir);
  else writeNote({ ...note, stale: true }, dir);
}

// The public-sharing switch: off until the user turns it on in Settings → Security.
const settingsFile = (dir: string) => path.join(dir, "settings.json");

export function publicSharingOn(dir = NOTES_DIR): boolean {
  try {
    return (JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ settingsFile(dir), "utf8")) as { public?: unknown }).public === true;
  } catch {
    return false;
  }
}

export function setPublicSharing(on: boolean, dir = NOTES_DIR) {
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ settingsFile(dir), JSON.stringify({ public: on }, null, 2));
}

// The outbox: scrubbed, scanned notes waiting for the user to look at them and send them to everyone.
export type OutboxItem = { id: string; host: string; path: string; body: string; queuedAt: string };
const outboxFile = (dir: string) => path.join(dir, "outbox.json");

export function listOutbox(dir = NOTES_DIR): OutboxItem[] {
  try {
    const items = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ outboxFile(dir), "utf8")) as unknown;
    return Array.isArray(items) ? (items as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

function saveOutbox(items: OutboxItem[], dir: string) {
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ outboxFile(dir), JSON.stringify(items, null, 2));
}

// One item per host and path: a newer draft of the same note replaces the one waiting.
export function queueOutbox(item: Omit<OutboxItem, "id" | "queuedAt">, dir = NOTES_DIR, now = new Date()) {
  const id = `${item.host}${item.path}`;
  const rest = listOutbox(dir).filter((i) => i.id !== id);
  saveOutbox([...rest, { ...item, id, queuedAt: now.toISOString() }].slice(-50), dir);
}

// Takes the named items out (all of them with no ids), returning what was taken.
export function takeOutbox(ids: string[] | undefined, dir = NOTES_DIR): OutboxItem[] {
  const items = listOutbox(dir);
  const taken = ids ? items.filter((i) => ids.includes(i.id)) : items;
  saveOutbox(
    items.filter((i) => !taken.includes(i)),
    dir,
  );
  return taken;
}
