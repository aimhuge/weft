// Helpers around the cloud_app_shares row: read it, derive the row's columns from the app on
// disk, and turn the answer into an AppShareState the dialog can render. lib/app-share.ts is the
// entry point; this file is the row-only toolkit so the entry can stay under the 300-line cap.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256Of } from "./blob-store";
import { createBlobStore } from "./blob-store";
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import { AppShareError } from "./app-share-errors";
import { listOwners, publicUrlFor } from "./app-share-owners";
import { appShareUrl, type AppOwner, type AppPolicy, type AppShareKind, type AppShareState } from "./app-share-types";
import type { AppShareMemo, MiniApp } from "./mini-apps";
import { rememberAppShare } from "./mini-app-store";
import type { AppManifestUpload, AppFolderFile } from "./app-folder";
import { cleanPreview } from "./app-preview";
import { isPreviewing } from "./app-preview-capture";
import { isCardShareMode, type CardShareMode } from "./share-types";

export interface AppShareRow {
  id: string;
  mode: string;
  has_password: boolean | null;
  name: string;
  kind: string;
  page: string;
  owner: AppOwner;
  slug: string | null;
  files: Record<string, string> | null;
  manifest: AppManifestUpload | null;
  // The row's workspace id: the sharer's own for a "user" owner, the picked workspace for "org".
  // Optional so tests can omit it; getAppShare's getAppShare result must always carry it.
  org_id?: string;
  // The link preview (lib/app-preview.ts), as the Mac last wrote it.
  preview?: unknown;
}

// The shape the ready helper returns: the signed-in user, their org, the app, and the page the
// share will show. The same ctx drives the row read, the page upload, and the state shape.
export interface Ready {
  client: SupabaseClient;
  orgId: string;
  userId: string;
  app: MiniApp;
  page:
    | { kind: "blob"; local: string; hash: string }
    | { kind: "site"; url: string }
    | { kind: "folder"; folder: string; entry: string; files: AppFolderFile[]; manifest: AppManifestUpload };
}

export function check(error: { message: string } | null) {
  if (error) throw new AppShareError(error.message, 500);
}

export async function readShare(t: Ready): Promise<AppShareRow | null> {
  // An "org" owner puts the row under another workspace; read by sharer and app, not by t.orgId, so the
  // dialog finds the row regardless of which workspace the link was created under.
  const result: { data: AppShareRow | null; error: { message: string } | null } =
    await t.client
      .from("cloud_app_shares")
      .select("id, mode, has_password, name, kind, page, owner, slug, files, manifest, org_id, preview")
      .eq("created_by", t.userId)
      .eq("app_id", t.app.id)
      .maybeSingle<AppShareRow>();
  check(result.error);
  return result.data;
}

// The row's kind, page, files map, and manifest for what the app is now. `upload` sends a local
// page's bytes up first; a folder app uploads every file in `files`. The orgId argument is the
// workspace the row will live under: t.orgId (the sharer's own) for a "user" owner, the picked
// workspace for an "org" owner.
export async function currentPage(
  t: Ready,
  upload: boolean,
  orgId: string,
): Promise<{ kind: AppShareKind; page: string; files: Record<string, string> | null; manifest: AppManifestUpload | null }> {
  if (t.page.kind === "site") return { kind: "site", page: t.page.url, files: null, manifest: null };
  if (t.page.kind === "folder") {
    const files: Record<string, string> = {};
    const store = createBlobStore({ client: t.client });
    for (const file of t.page.files) {
      const sha = await sha256Of(file.absolute);
      if (!sha) throw new AppShareError(`${file.relative} is gone.`, 404);
      if (upload) await store.upload(file.absolute, orgId);
      files[file.relative] = sha;
    }
    return { kind: "folder", page: t.page.entry, files, manifest: t.page.manifest };
  }
  const sha = await sha256Of(t.page.local);
  if (!sha) throw new AppShareError("This app's page is gone.", 404);
  if (upload) await createBlobStore({ client: t.client }).upload(t.page.local, orgId);
  return { kind: "blob", page: `${BLOB_REF_PREFIX}${sha}${t.page.hash}`, files: null, manifest: null };
}

// The page a share write will point at. Changing who may open the link doesn't change the page, so the
// bytes go up only when the row doesn't already point at them under this workspace: a folder app is one
// storage round trip per file, and a save used to make them all again.
export async function pageForWrite(t: Ready, existing: AppShareRow | null, orgId: string): ReturnType<typeof currentPage> {
  const now = await currentPage(t, false, orgId);
  const there = existing && (existing.org_id ?? t.orgId) === orgId && existing.page === now.page && sameFiles(existing.files, now.files);
  if (!there) await currentPage(t, true, orgId);
  return now;
}

export function sameFiles(a: Record<string, string> | null, b: Record<string, string> | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) if (a[k] !== b[k]) return false;
  return true;
}

export function sameManifest(a: AppManifestUpload | null, b: AppManifestUpload | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// A row with a mode this build doesn't know reads as private: fail closed. The memo goes on the app in apps.json.
export async function stateOf(t: Ready, row: AppShareRow | null): Promise<AppShareState> {
  const owners = await listOwners(t);
  const state = buildState(t, row, owners);
  // The remembered row exists (or did and was just cleared elsewhere); write a fresh memo either way so
  // the next paint reads the latest row.
  if (row || t.app.share?.id) rememberAppShare(t.app.id, memoOf(state));
  return state;
}

// The state the dialog renders: kind, mode, password, owner, slug, publicUrl. Owners and slug come
// from the row; the public URL is rebuilt through listOwners + publicUrlFor.
function buildState(t: Ready, row: AppShareRow | null, owners: Awaited<ReturnType<typeof listOwners>>): Extract<AppShareState, { kind: "ok" }> {
  const owner: AppOwner | null = row?.owner ?? null;
  const slug = row?.slug ?? null;
  const rowOrgId = row?.org_id ?? t.orgId;
  const orgId = owner === "org" ? rowOrgId : null;
  const publicUrl = owner && slug ? publicUrlFor(owner, slug, owners, rowOrgId) : null;
  return {
    kind: "ok",
    id: row?.id ?? null,
    url: row ? appShareUrl(row.id) : null,
    mode: rowMode(row),
    hasPassword: Boolean(row?.has_password),
    shows: pageKind(t),
    owner,
    slug,
    orgId,
    publicUrl,
    owners,
    manifest: shareManifest(t, row),
    preview: cleanPreview(row?.preview),
    previewing: isPreviewing(t.app.id),
  };
}

// What the row says about the share mode (a row from an older build may have one we don't know;
// fail closed to "private"). The page kind for the link ("blob" for a single file, "site" for an
// https URL, "folder" for a folder app) follows t.page, not the row, since the share always shows
// the live page.
function rowMode(row: AppShareRow | null): CardShareMode {
  return row && isCardShareMode(row.mode) ? row.mode : "private";
}

function pageKind(t: Ready): AppShareKind {
  return t.page.kind === "folder" ? "folder" : t.page.kind === "site" ? "site" : "blob";
}

// The manifest is on the row for a folder app, or derived from the folder for a fresh upload; the
// dialog reads it to know when to show "Upload secrets" (author secrets or public names).
function shareManifest(t: Ready, row: AppShareRow | null): AppPolicy | null {
  if (t.page.kind === "folder") return t.page.manifest as AppPolicy;
  return (row?.manifest as AppPolicy | null | undefined) ?? null;
}

// No row (never shared, or taken down elsewhere) clears a stale memo too; an unchanged one isn't written again.
function memoOf(state: AppShareState): AppShareMemo {
  if (state.kind !== "ok") return { id: null, mode: "private", hasPassword: false };
  return {
    id: state.id, mode: state.mode, hasPassword: state.hasPassword, url: state.publicUrl,
    owner: state.owner, slug: state.slug, orgId: state.orgId,
  };
}
