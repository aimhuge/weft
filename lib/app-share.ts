// The Mac's side of a mini app's share link (lib/app-share-types.ts, docs/architecture/mini-apps.md): the app's Share
// dialog (components/ShareAppDialog.tsx) reads and sets its cloud_app_shares row through app/api/apps/share. It writes
// as the signed-in account into the workspace cloud sync uploads to, so RLS decides who may share: only the sharer.
// A mini app lives on this Mac, so the row carries its own copy of what to show: a local page uploaded to weft-blobs
// (re-uploaded when the file changed, each time the dialog opens), a public https site's address, or a whole folder
// (lib/app-folder.ts) the server serves by path. A page only this Mac can reach can't be shared, and the dialog
// says why.
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashSharePassword } from "@aimhuge/share/server";
import { accountClient } from "./account";
import { resolvePage } from "./blob-paths";
import { syncOrgId } from "./cloud-sync";
import { AppShareError } from "./app-share-errors";
import { listOwners } from "./app-share-owners";
import { refreshAppPreview } from "./app-preview-capture";
import { APP_SLUG_RE, type AppOwner, type AppShareState, type AppShareUpdate } from "./app-share-types";
import { isAppFolderUrl, listAppFolderFiles, reducedManifest, secretHit, type AppManifestUpload, type AppFolderFile } from "./app-folder";
import { listApps } from "./mini-app-store";
import type { MiniApp } from "./mini-apps";
import { isCardShareMode, newShareId } from "./share-types";
import { currentPage, readShare, sameFiles, sameManifest, stateOf, type Ready } from "./app-share-row";

export { AppShareError } from "./app-share-errors";

// What the link would show, or why it can't show anything. A folder is a special blob: the entry
// file, with every file listed in the share's `files` jsonb so the server can serve them.
export type AppPage =
  | { kind: "blob"; local: string; hash: string }
  | { kind: "site"; url: string }
  | { kind: "folder"; folder: string; entry: string; files: AppFolderFile[]; manifest: AppManifestUpload }
  | { kind: "none"; reason: string };

// Hosts the weft.zip server can't reach from its own data center: this loopback range,
// loopback IPv6, RFC1918 private IPv4, link-local ranges (169.254/16 and fe80::/10) and
// *.localhost / *.local (mDNS). Checked before any protocol gate so https on a Mac-only or
// LAN-only server is refused the same way http is.
const LOCAL_HOST = /^(localhost|.*\.localhost|.*\.local|127(\.\d+){3}|0\.0\.0\.0|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|169\.254(\.\d+){2}|\[::1\]|\[fe80[0-9a-f:]*\]|\[fc[0-9a-f]{2}:[0-9a-f:]*\])$/i;

// Mac-only hosts (loopback, mDNS, 0.0.0.0) — distinct from the network-only ones in LOCAL_HOST,
// so the error message can say which one the user's at.
const MAC_HOST = /^(localhost|.*\.localhost|.*\.local|0\.0\.0\.0|127(\.\d+){3}|\[::1\]|\[::1\]:.*)$/i;

function explainLocalHost(u: URL): string {
  // A Mac-only dev server (localhost / *.localhost / *.local) or a private-network host: a
  // weft.zip frame has no way to reach either from its own server, so a link to this page
  // would always fail. The message names the host so the user can tell why.
  if (MAC_HOST.test(u.hostname)) {
    return `This app runs on your Mac (${u.host}), so a weft.zip link can't reach it. Save its deployed address as an app and share that.`;
  }
  return `This app is on your network (${u.host}), so a weft.zip link can't reach it. Save its public address as an app and share that.`;
}

function filePage(url: string, home?: string): AppPage {
  const folder = isAppFolderUrl(url);
  if (folder) {
    try {
      const files = listAppFolderFiles(folder.folder);
      const manifest = readManifest(folder.folder);
      return { kind: "folder", folder: folder.folder, entry: folder.entry, files, manifest };
    } catch (err) {
      return { kind: "none", reason: err instanceof Error ? err.message : "This app's folder couldn't be shared." };
    }
  }
  const page = resolvePage(url, home);
  if (page) return { kind: "blob", ...page };
  return { kind: "none", reason: "This app's file is gone, outside your home folder, or one Weft never uploads (a secret, the vault)." };
}

export function appPage(url: string, home?: string): AppPage {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: "none", reason: "This app's address isn't a page Weft can share." };
  }
  if (u.protocol === "file:") return filePage(url, home);
  if (LOCAL_HOST.test(u.hostname)) return { kind: "none", reason: explainLocalHost(u) };
  if (u.protocol !== "https:") return { kind: "none", reason: "Only https sites can be shown under a weft.zip link." };
  return { kind: "site", url: u.href };
}

function readManifest(folder: string): AppManifestUpload {
  const manifestPath = path.join(folder, "weft-app.json");
  if (!fs.existsSync(manifestPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    return reducedManifest(parsed);
  } catch {
    return {};
  }
}

// The target the share dialog works against: a ready context (the signed-in user, their org, the
// app, the page) or a blocked reason to surface. Discriminated by `kind` so callers can branch.
export type Target = { kind: "ready" } & Ready | { kind: "blocked"; state: AppShareState };

function check(error: { message: string } | null) {
  if (error) throw new AppShareError(error.message, 500);
}

async function signedIn(): Promise<{ client: SupabaseClient; userId: string } | null> {
  let client: SupabaseClient;
  try {
    client = accountClient();
  } catch {
    return null; // accounts aren't set up in this build
  }
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  return userId ? { client, userId } : null;
}

// Also the preview routes' way in (lib/app-share-preview-actions.ts).
export async function target(appId: string): Promise<Target> {
  const app = listApps().find((a) => a.id === appId);
  if (!app) throw new AppShareError("No such app.", 404);
  const account = await signedIn();
  if (!account) return { kind: "blocked", state: { kind: "signed-out" } };
  const orgId = await syncOrgId(account.client, account.userId);
  if (!orgId) return { kind: "blocked", state: { kind: "no-workspace" } };
  const page = appPage(app.url);
  if (page.kind === "none") return { kind: "blocked", state: { kind: "unshareable", reason: page.reason } };
  return { kind: "ready", ...account, orgId, app, page };
}

export async function getAppShare(appId: string): Promise<AppShareState> {
  const t = await target(appId);
  if (t.kind === "blocked") return t.state;
  const row = await readShare(t);
  if (!row) return stateOf(t, null);
  // Row's workspace: required to upload under and to write back; a row from before org_id existed
  // (or a test fixture that omits it) lands in the sharer's own workspace, like setAppShare's pick.
  const orgId = row.org_id ?? t.orgId;
  // Same scan as setAppShare: refuse a re-upload of files that look key-shaped, so the automatic
  // re-upload path doesn't bypass the gate setAppShare applies before its row write.
  rejectFolderSecrets(t);
  const now = await currentPage(t, false, orgId);
  if (
    row.name === t.app.name &&
    row.kind === now.kind &&
    row.page === now.page &&
    sameFiles(row.files, now.files) &&
    sameManifest(row.manifest, now.manifest)
  ) {
    // The link preview catches up in the background when the page changed since it was made.
    void refreshAppPreview(t, row, now);
    return stateOf(t, row);
  }
  if (row.page !== now.page || !sameFiles(row.files, now.files)) await currentPage(t, true, orgId);
  const writeError = await updateShareRow(t, row.id, {
    name: t.app.name, kind: now.kind, page: now.page, files: now.files, manifest: now.manifest,
    owner: row.owner, slug: row.slug, org_id: orgId,
  });
  if (writeError) throw new AppShareError(writeError.message, 500);
  return previewed(t, now);
}

// The row as written, with its link preview started in the background (lib/app-preview-capture.ts).
async function previewed(t: Ready, now: Parameters<typeof refreshAppPreview>[2]): Promise<AppShareState> {
  const row = await readShare(t);
  if (row) void refreshAppPreview(t, row, now);
  return stateOf(t, row);
}

function badSlug(value: unknown): string | null {
  if (typeof value !== "string" || !APP_SLUG_RE.test(value)) return "Pick an address of 1 to 40 letters, digits, or hyphens.";
  return null;
}

// A unique-index violation comes back as Postgres's "duplicate key value" message; the route
// surfaces it as a 400 with this friendlier wording.
function isDuplicateSlug(err: { message: string } | null): boolean {
  if (!err) return false;
  return /duplicate key|already exists/i.test(err.message);
}

export async function setAppShare(appId: string, update: AppShareUpdate): Promise<AppShareState> {
  // Never public_edit: a mini app is the sharer's page, not something a visitor changes.
  if (!isCardShareMode(update.mode)) throw new AppShareError("Unknown share mode.", 400);
  const password = typeof update.password === "string" && update.password !== "" ? update.password : undefined;
  const t = await target(appId);
  if (t.kind === "blocked") return t.state;
  const existing = await readShare(t);
  if (update.mode === "password" && !password && !existing?.has_password) throw new AppShareError("Set a password first.", 400);
  const { nextOwner, nextSlug } = await resolveOwnerAndSlug(update, existing, t);
  rejectFolderSecrets(t);
  const nextOrgId: string = nextOwner === "org" ? (update.orgId ?? t.orgId) : t.orgId;
  const now = await currentPage(t, true, nextOrgId);
  const change = buildChange(update, t, now, nextOwner, nextSlug, password);
  const writeError = await writeShareRow(t, existing, change);
  if (writeError) throwAsError(writeError);
  return previewed(t, now);
}

// What the row will say about who owns the link and under what address. Carries "user" / "org" with
// the new pick winning over what's already there, and the slug validated up front so we never write a
// row we know the server will reject. A user-owner link lands on the sharer's own workspace; an org
// owner lands on the picked workspace, and the user must belong to it.
async function resolveOwnerAndSlug(
  update: AppShareUpdate,
  existing: Awaited<ReturnType<typeof readShare>>,
  t: Ready,
): Promise<{ nextOwner: AppOwner; nextSlug: string | null }> {
  const nextOwner: AppOwner = update.owner ?? existing?.owner ?? "user";
  const nextSlug: string | null = update.slug !== undefined ? update.slug : existing?.slug ?? null;
  if (nextSlug !== null) {
    const msg = badSlug(nextSlug);
    if (msg) throw new AppShareError(msg, 400);
  }
  if (update.owner === "org" && !update.orgId) throw new AppShareError("Pick a workspace.", 400);
  if (nextOwner === "org") {
    const owners = await listOwners(t);
    const targetOrg = update.orgId ?? t.orgId;
    if (!owners.orgs.some((o) => o.id === targetOrg)) throw new AppShareError("You don't belong to that workspace.", 400);
  }
  return { nextOwner, nextSlug };
}

// A folder share's files are uploaded as-is; refuse one that includes anything key-shaped.
function rejectFolderSecrets(t: Ready) {
  if (t.page.kind !== "folder" || !t.page.files.length) return;
  for (const file of t.page.files) {
    const hit = secretHit(file);
    if (hit) throw new AppShareError(hit, 400);
  }
}

// The row we're about to write: the mode, the app's name, what the page is now (kind + page + files
// + manifest), who owns the link, the slug, and the row's org_id. password_hash is dropped for
// every mode except "password" (so a password gate never re-opens unseen when the mode changes).
function buildChange(
  update: AppShareUpdate,
  t: Ready,
  now: { kind: string; page: string; files: Record<string, string> | null; manifest: AppManifestUpload | null },
  nextOwner: AppOwner,
  nextSlug: string | null,
  password: string | undefined,
): Record<string, unknown> {
  const change: Record<string, unknown> = {
    mode: update.mode,
    name: t.app.name,
    kind: now.kind,
    page: now.page,
    owner: nextOwner,
    slug: nextSlug,
    files: now.files,
    manifest: now.manifest,
  };
  // The row's org_id is the workspace the link lives under: syncOrgId (the sharer's own) for a "user"
  // owner, the picked workspace for an "org" owner. set before the spread so it always wins.
  change.org_id = nextOwner === "org" ? update.orgId ?? t.orgId : t.orgId;
  if (update.mode !== "password") change.password_hash = null;
  else if (password) change.password_hash = hashSharePassword(password);
  return change;
}

async function writeShareRow(
  t: Ready,
  existing: Awaited<ReturnType<typeof readShare>>,
  change: Record<string, unknown>,
): Promise<{ message: string } | null> {
  const shares = t.client.from("cloud_app_shares");
  const result = existing
    ? await shares.update(change).eq("id", existing.id)
    : await shares.insert({ ...change, id: newShareId(), app_id: t.app.id });
  return result.error ? { message: result.error.message } : null;
}

// Typed wrappers around the cloud_app_shares calls so the unsafe-Supabase-client lint flags land
// in one place instead of every call site. They keep what we care about (the error message) and
// the return shape is narrowed so callers don't see "error | null" of unknown provenance.
type ShareWriteResult = { message: string } | null;

interface UpdateArgs {
  name: string;
  kind: string;
  page: string;
  files: Record<string, string> | null;
  manifest: AppManifestUpload | null;
  owner: AppOwner;
  slug: string | null;
  org_id: string;
}

async function updateShareRow(t: Ready, rowId: string, change: UpdateArgs): Promise<ShareWriteResult> {
  const result = (await t.client.from("cloud_app_shares").update(change as unknown as Record<string, unknown>).eq("id", rowId)) as { error: { message: string } | null };
  return result.error ? { message: result.error.message } : null;
}

async function deleteShareByAppId(client: SupabaseClient, userId: string, appId: string): Promise<ShareWriteResult> {
  const result = (await client.from("cloud_app_shares").delete().eq("created_by", userId).eq("app_id", appId)) as { error: { message: string } | null };
  return result.error ? { message: result.error.message } : null;
}

function throwAsError(error: { message: string }) {
  if (isDuplicateSlug(error)) throw new AppShareError("That address is taken.", 400);
  throw new AppShareError(error.message, 500);
}

// Removing an app takes its link down too, in every workspace. Best effort: signed out, the row stays until you share again.
export async function dropAppShare(app: MiniApp | undefined): Promise<void> {
  if (!app?.share?.id) return;
  const account = await signedIn();
  if (!account) return;
  const error = await deleteShareByAppId(account.client, account.userId, app.id);
  check(error);
}
