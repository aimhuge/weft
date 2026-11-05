// Which version of a cloud site note gets served, and to whom (docs/architecture/site-notes.md#confirmation).
// Every upload is a version; every card that used one reports success or failure, one row per user per version.
// A public version is served to everyone once CONFIRMATIONS different users (never its author) have succeeded
// with it; until then it is a candidate, served only to people who contribute notes, marked unconfirmed. A
// failure newer than the last success makes a version stale. Team notes are trusted by the team and served at
// once. Pure: weft.zip's route (lib/site-notes-cloud.ts) feeds it the rows.

export const CONFIRMATIONS = 3;

export type NoteRow = { id: string; host: string; path: string; scope: "team" | "public"; org_id: string | null };
export type VersionRow = { id: string; note_id: string; body: string; author_id: string | null; created_at: string };
export type ReportRow = { version_id: string; user_id: string; outcome: "success" | "failure"; updated_at: string };

export type VersionState = { confirmations: number; failures: number; stale: boolean; confirmed: boolean; lastSuccess?: string };

export type ServedVersion = {
  noteId: string;
  host: string;
  path: string;
  scope: "team" | "public";
  versionId: string;
  body: string;
  confirmations: number;
  stale: boolean;
  candidate: boolean;
  lastSuccess?: string;
};

export function versionState(version: VersionRow, reports: ReportRow[]): VersionState {
  const mine = reports.filter((r) => r.version_id === version.id);
  const successes = mine.filter((r) => r.outcome === "success");
  const failures = mine.filter((r) => r.outcome === "failure");
  const latest = (rows: ReportRow[]) => rows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), "");
  const lastSuccess = latest(successes);
  const stale = failures.length > 0 && latest(failures) > lastSuccess;
  const confirmations = new Set(successes.filter((r) => r.user_id !== version.author_id).map((r) => r.user_id)).size;
  return { confirmations, failures: failures.length, stale, confirmed: confirmations >= CONFIRMATIONS && !stale, ...(lastSuccess ? { lastSuccess: lastSuccess.slice(0, 10) } : {}) };
}

function served(note: NoteRow, version: VersionRow, state: VersionState, candidate: boolean): ServedVersion {
  return {
    noteId: note.id,
    host: note.host,
    path: note.path,
    scope: note.scope,
    versionId: version.id,
    body: version.body,
    confirmations: state.confirmations,
    stale: state.stale,
    candidate,
    ...(state.lastSuccess ? { lastSuccess: state.lastSuccess } : {}),
  };
}

// The version of one note to serve, or null. `contributor` is a user who shares notes publicly: they see the
// newest candidate, which is how a candidate collects its confirmations.
export function pickVersion(note: NoteRow, versions: VersionRow[], reports: ReportRow[], contributor: boolean): ServedVersion | null {
  const mine = versions.filter((v) => v.note_id === note.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const states = mine.map((v) => ({ v, s: versionState(v, reports) }));
  const [newest] = states;
  if (!newest) return null;
  if (note.scope === "team") {
    const fresh = states.find((x) => !x.s.stale) ?? newest;
    return served(note, fresh.v, fresh.s, false);
  }
  const confirmed = states.find((x) => x.s.confirmed);
  if (contributor && !newest.s.stale && confirmed !== newest) return served(note, newest.v, newest.s, true);
  return confirmed ? served(note, confirmed.v, confirmed.s, false) : null;
}
