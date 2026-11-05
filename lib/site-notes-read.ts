import { notesBlock, type SiteNote } from "./site-notes-format";
import { sanitizeNote } from "./site-notes-safety";
import { recordServed, wasServed } from "./site-notes-trail";
import { noteKeyFor, pathMatches } from "./site-notes-url";

// What open_url hands a card about the page it just opened (docs/architecture/site-notes.md#read): its own
// Mac's notes, its team's and the public ones, scanned once more and wrapped as untrusted reference data
// (lib/site-notes-format.ts). Remote reads are cached and time out fast (lib/site-notes-remote.ts).

export type ReadDeps = { local: (host: string) => SiteNote[]; remote: (host: string) => Promise<SiteNote[]> };

const MAX_MATCHED = 3;
const ORDER: Record<SiteNote["source"], number> = { local: 0, team: 1, public: 2 };

function safe(notes: SiteNote[]): SiteNote[] {
  const out: SiteNote[] = [];
  for (const note of notes) {
    const checked = sanitizeNote(note.body, note.host);
    if (!checked.rejected) out.push({ ...note, body: checked.body });
  }
  return out;
}

export async function notesForUrl(cardId: string | undefined, url: string, deps: ReadDeps): Promise<string> {
  const key = noteKeyFor(url);
  if (!key) return "";
  const remote = await deps.remote(key.host).catch(() => [] as SiteNote[]);
  const all = safe([...deps.local(key.host), ...remote]).sort((a, b) => ORDER[a.source] - ORDER[b.source]);
  const matched = all.filter((n) => pathMatches(n.path, key.path));
  const others = all.filter((n) => !matched.includes(n));
  if (matched.length && matched.every((n) => wasServed(cardId, key.host, n.path))) return `The site notes for ${key.host}${key.path} are earlier in this turn.`;
  const shown = matched.slice(0, MAX_MATCHED);
  for (const note of shown) recordServed(cardId, { host: key.host, path: note.path, source: note.source, ...(note.versionId ? { versionId: note.versionId } : {}) });
  return notesBlock(key.host, shown, others);
}
