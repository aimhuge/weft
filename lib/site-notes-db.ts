import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoteRow, ReportRow, VersionRow } from "./site-notes-status";

// The site-notes tables as weft.zip's service role reads and writes them (supabase/migrations/*_site_notes.sql).
// One narrow port, so lib/site-notes-cloud.ts holds the rules and stays testable without a database.

export type OrgShare = { id: string; shareTeam: boolean };

export interface SiteNotesDb {
  orgsFor(userId: string): Promise<OrgShare[]>;
  currentOrgId(userId: string): Promise<string | null>;
  notesForHost(host: string, orgIds: string[]): Promise<NoteRow[]>;
  versionsFor(noteIds: string[]): Promise<VersionRow[]>;
  reportsFor(versionIds: string[]): Promise<ReportRow[]>;
  uploadsSince(userId: string, sinceIso: string): Promise<number>;
  upsertNote(row: Omit<NoteRow, "id">): Promise<string>;
  insertVersion(row: { note_id: string; body: string; body_hash: string; author_id: string }): Promise<string>;
  noteOfVersion(versionId: string): Promise<NoteRow | null>;
  upsertReport(row: { version_id: string; user_id: string; outcome: "success" | "failure"; step: string | null }): Promise<void>;
}

type Result<T> = { data: T | null; error: { message: string } | null };

function rows<T>(r: Result<T>): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

const VERSION_COLUMNS = "id, note_id, body, author_id, created_at";
const NOTE_COLUMNS = "id, host, path, scope, org_id";
const MAX_VERSIONS = 200;

export function supabaseNotesDb(db: SupabaseClient): SiteNotesDb {
  return {
    async orgsFor(userId) {
      const r = (await db.from("org_memberships").select("org_id, orgs(site_notes_team)").eq("user_id", userId)) as Result<
        Array<{ org_id: string; orgs: { site_notes_team: boolean } | null }>
      >;
      return rows(r).map((m) => ({ id: m.org_id, shareTeam: m.orgs?.site_notes_team !== false }));
    },
    async currentOrgId(userId) {
      const r = (await db.from("profiles").select("current_org_id").eq("id", userId).maybeSingle()) as Result<{ current_org_id: string | null } | null>;
      return rows(r)?.current_org_id ?? null;
    },
    async notesForHost(host, orgIds) {
      const scope = orgIds.length ? `scope.eq.public,org_id.in.(${orgIds.join(",")})` : "scope.eq.public";
      return rows((await db.from("site_notes").select(NOTE_COLUMNS).eq("host", host).or(scope)) as Result<NoteRow[]>);
    },
    async versionsFor(noteIds) {
      if (!noteIds.length) return [];
      const r = await db.from("site_note_versions").select(VERSION_COLUMNS).in("note_id", noteIds).order("created_at", { ascending: false }).limit(MAX_VERSIONS);
      return rows(r as Result<VersionRow[]>);
    },
    async reportsFor(versionIds) {
      if (!versionIds.length) return [];
      return rows((await db.from("site_note_reports").select("version_id, user_id, outcome, updated_at").in("version_id", versionIds)) as Result<ReportRow[]>);
    },
    async uploadsSince(userId, sinceIso) {
      const r = (await db.from("site_note_versions").select("id", { count: "exact", head: true }).eq("author_id", userId).gte("created_at", sinceIso)) as Result<null> & { count: number | null };
      rows(r);
      return r.count ?? 0;
    },
    async upsertNote(row) {
      const r = await db.from("site_notes").upsert(row, { onConflict: "host,path,scope,org_id" }).select("id").single();
      return rows(r as Result<{ id: string }>).id;
    },
    // The same body uploaded again is the same version, and keeps its first author.
    async insertVersion(row) {
      const r = await db.from("site_note_versions").upsert(row, { onConflict: "note_id,body_hash", ignoreDuplicates: true }).select("id");
      const made = rows(r as Result<Array<{ id: string }>>);
      if (made[0]) return made[0].id;
      const existing = await db.from("site_note_versions").select("id").eq("note_id", row.note_id).eq("body_hash", row.body_hash).single();
      return rows(existing as Result<{ id: string }>).id;
    },
    async noteOfVersion(versionId) {
      const r = (await db.from("site_note_versions").select(`site_notes(${NOTE_COLUMNS})`).eq("id", versionId).maybeSingle()) as Result<{ site_notes: NoteRow | null } | null>;
      return rows(r)?.site_notes ?? null;
    },
    async upsertReport(row) {
      rows((await db.from("site_note_reports").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "version_id,user_id" })) as Result<null>);
    },
  };
}
