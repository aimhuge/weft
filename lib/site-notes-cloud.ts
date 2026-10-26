import { createHash } from "node:crypto";
import type { SiteNotesDb } from "./site-notes-db";
import { sanitizeNote, type NoteFinding } from "./site-notes-safety";
import { scrubText } from "./site-notes-scrub";
import { pickVersion, type ServedVersion } from "./site-notes-status";
import { validKey } from "./site-notes-store";
import { isPrivateHost, isPublicShareable } from "./site-notes-url";

// The rules weft.zip's /api/site-notes/cloud enforces (docs/architecture/site-notes.md#share). The desktop
// already scrubbed and scanned a note, but this is the door every other user's prompt sits behind, so it does
// both again, checks the tier (a workspace you're in, with team sharing on; a public-worthy host), and caps
// how much one account can upload in a day.

export const DAILY_UPLOADS = 60;
const MAX_STEP = 300;

export type CloudResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; findings?: NoteFinding[] };

const fail = (status: number, error: string, findings?: NoteFinding[]): CloudResult<never> => ({ ok: false, status, error, ...(findings ? { findings } : {}) });

export async function notesForHost(db: SiteNotesDb, userId: string, host: string, contributor: boolean): Promise<CloudResult<ServedVersion[]>> {
  if (!validKey(host, "/") || isPrivateHost(host)) return fail(400, "bad-host");
  const orgs = (await db.orgsFor(userId)).filter((o) => o.shareTeam);
  const notes = await db.notesForHost(host, orgs.map((o) => o.id));
  const versions = await db.versionsFor(notes.map((n) => n.id));
  const reports = await db.reportsFor(versions.map((v) => v.id));
  const out: ServedVersion[] = [];
  for (const note of notes) {
    // RLS-free tables: the query asked for public and these orgs, and this re-checks it.
    if (note.scope === "team" && !orgs.some((o) => o.id === note.org_id)) continue;
    const picked = pickVersion(note, versions, reports, contributor);
    // Served bodies are scanned on the way out too, so a rule added later covers notes stored earlier.
    const safe = picked && sanitizeNote(picked.body, host);
    if (picked && safe && !safe.rejected) out.push({ ...picked, body: safe.body });
  }
  return { ok: true, value: out };
}

export type Upload = { host: string; path: string; body: string; scope: "team" | "public"; orgId?: string };

export async function uploadNote(db: SiteNotesDb, userId: string, upload: Upload, now = new Date()): Promise<CloudResult<{ versionId: string; findings: NoteFinding[] }>> {
  const { host, path, scope } = upload;
  if (!validKey(host, path) || isPrivateHost(host)) return fail(400, "bad-key");
  if (scope === "public" && !isPublicShareable(host)) return fail(400, "not-public-host");
  let orgId: string | null = null;
  if (scope === "team") {
    // No workspace named: the one the user is in now on weft.zip.
    const wanted = upload.orgId ?? (await db.currentOrgId(userId));
    const org = (await db.orgsFor(userId)).find((o) => o.id === wanted);
    if (!org) return fail(404, "not-a-member");
    if (!org.shareTeam) return fail(403, "team-sharing-off");
    orgId = org.id;
  }
  const safe = sanitizeNote(scrubText(upload.body), host);
  if (safe.rejected) return fail(422, "rejected", safe.findings);
  const since = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  if ((await db.uploadsSince(userId, since)) >= DAILY_UPLOADS) return fail(429, "too-many");
  const noteId = await db.upsertNote({ host, path, scope, org_id: orgId });
  const bodyHash = createHash("sha256").update(safe.body).digest("hex");
  const versionId = await db.insertVersion({ note_id: noteId, body: safe.body, body_hash: bodyHash, author_id: userId });
  return { ok: true, value: { versionId, findings: safe.findings } };
}

export type Report = { versionId: string; outcome: "success" | "failure"; step?: string };

export async function reportOutcome(db: SiteNotesDb, userId: string, report: Report): Promise<CloudResult<null>> {
  const note = await db.noteOfVersion(report.versionId);
  if (!note) return fail(404, "no-version");
  if (note.scope === "team") {
    const orgs = await db.orgsFor(userId);
    if (!orgs.some((o) => o.id === note.org_id)) return fail(404, "no-version");
  }
  const step = report.step ? scrubText(report.step).slice(0, MAX_STEP) : null;
  await db.upsertReport({ version_id: report.versionId, user_id: userId, outcome: report.outcome, step });
  return { ok: true, value: null };
}
