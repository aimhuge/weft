// Share links for a mini app (lib/mini-apps.ts): one URL, weft.zip/a/<id>, that shows the app's page to whoever the
// link is for, behind the same @aimhuge/share modes as a card's link (lib/share-types.ts). The contract between the parts:
// - the desktop writes a cloud_app_shares row through the signed-in account (app/api/apps/share, lib/app-share.ts),
//   with a copy of what to show: a local page uploaded as a blob, or a public https site's address,
// - the deployed Weft reads it with the service client, checks the gate (lib/app-share-access.ts) and serves the
//   viewer (app/a/[id]) and the page itself (app/api/a/[id]/page).
// Pure, so the dialog and the viewer import it too.
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import type { AppPreview } from "./app-preview";
import type { MiniApp } from "./mini-apps";
import type { CardShareMode } from "./share-types";
import { SITE } from "./site";

// blob: a page from this Mac, uploaded to weft-blobs and served sandboxed. site: a public https site, framed as is.
// folder: a whole app folder (a React app's build, or hand-written HTML with its scripts, styles and images), every
// file uploaded by hash and served by path (docs/architecture/mini-app-hosting.md).
export type AppShareKind = "blob" | "site" | "folder";

// Who a link lives under: you, at weft.zip/@username/apps/<slug>, or a workspace, at weft.zip/<org-slug>/apps/<slug>.
export type AppOwner = "user" | "org";

// One secret an app may use by reference (`{{secret:NAME}}` in a weft.fetch request) and where it may go: the hosts
// (exact, or `*.example.com`), methods and path prefixes. `from: "viewer"` means each viewer brings their own value.
export interface AppSecretRule {
  from?: "author" | "viewer";
  hosts: string[];
  methods?: string[];
  paths?: string[];
}

// The app's policy, from its weft-app.json: what it may reach and with which secrets, plus the values it may see as
// they are (`public`, publishable keys) and its named reads. The local-only parts (the vault folder and env) never go up.
export interface AppPolicy {
  secrets?: Record<string, AppSecretRule>;
  public?: string[];
  reads?: Record<string, unknown>;
  supabaseUrl?: string;
}

// public.cloud_app_shares (supabase/migrations/20261018131912_app_shares.sql, 20261019095618_app_hosting.sql).
export interface CloudAppShareRow {
  id: string;
  org_id: string;
  app_id: string;
  name: string;
  kind: AppShareKind;
  // `blob:sha256:<hex>#hash` for a blob, the https address for a site, the entry file's path (index.html) for a folder.
  page: string;
  mode: CardShareMode;
  // Clients can't select it (column grants); they read has_password.
  password_hash?: string | null;
  has_password?: boolean;
  created_by?: string;
  owner: AppOwner;
  // The link's last segment under its owner; null for a link made before slugs, which only /a/<id> reaches.
  slug: string | null;
  // A folder's files: relative path → sha256 of its blob in weft-blobs/<org_id>/<sha>.
  files: Record<string, string> | null;
  manifest: AppPolicy | null;
  // The link preview the Mac made (lib/app-preview.ts); read through cleanPreview, never trusted as is.
  preview?: unknown;
  created_at: string;
  updated_at: string;
}

export function appShareUrl(id: string, origin = SITE): string {
  return `${origin}/a/${id}`;
}

// The same rule as profiles.username and the slug column: lowercase letters, digits and inner hyphens, 1 to 40.
export const APP_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// An app's link under its owner.
export function appPublicUrl(owner: AppOwner, ownerSlug: string, slug: string, origin = SITE): string {
  return owner === "user" ? `${origin}/@${ownerSlug}/apps/${slug}` : `${origin}/${ownerSlug}/apps/${slug}`;
}

// A slug from an app's name ("📈 Growth" → "growth"), or "app" when nothing usable is left.
export function appSlugFrom(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return APP_SLUG_RE.test(slug) ? slug : "app";
}

// What the browser pane's address bar shows while nobody is editing it (components/BrowserPane.tsx). A saved app's own
// local page reads as the app's name, with its weft.zip link once it has one, instead of a file:///Users/… path. A web
// app, a page further in, and any other page show their address; focusing the bar shows the real one either way.
export function paneAddress(app: MiniApp | undefined, url: string): string {
  const bare = (u: string) => u.replace(/#.*$/, "");
  if (!app || !url.startsWith("file:") || bare(app.url) !== bare(url)) return url;
  if (!app.share?.id) return app.name;
  return `${app.name} · ${(app.share.url ?? appShareUrl(app.share.id)).replace(/^https?:\/\//, "")}`;
}

// A workspace the user can put an app link under: its slug and a display name, with the id the share row needs.
export interface AppOrgOption {
  id: string;
  slug: string;
  name: string;
}

// The own user, when the dialog can pick a personal link.
export interface AppUserOption {
  username: string;
}

// What GET /api/apps/share answers on the desktop, for the app's Share dialog.
export type AppShareState =
  | { kind: "signed-out" }
  | { kind: "no-workspace" }
  // A page only this Mac can reach (a dev server on localhost, a file Weft won't upload): `reason` says which.
  | { kind: "unshareable"; reason: string }
  | {
      kind: "ok";
      id: string | null;
      url: string | null;
      mode: CardShareMode;
      hasPassword: boolean;
      shows: AppShareKind;
      // The link's owner and its slug, or null when there is no link yet.
      owner: AppOwner | null;
      slug: string | null;
      orgId: string | null;
      // The public URL for the link, with its owner and slug, when both are set.
      publicUrl: string | null;
      // What the dialog's owner picker may pick: the user (themselves) and each workspace the account
      // is a member of. Empty until the user signs in.
      owners: { user: AppUserOption | null; orgs: AppOrgOption[] };
      // The folder app's manifest (lib/app-folder.ts), null for a single-page or site app. The dialog
      // reads it to know when to show "Upload secrets" (author secrets or public names).
      manifest: AppPolicy | null;
      // The link preview (lib/app-preview.ts), and whether the Mac is making a fresh one right now.
      preview: AppPreview | null;
      previewing: boolean;
    };

// PUT /api/apps/share. A password is hashed on the Mac and only its hash goes up; omitted keeps the old one.
export interface AppShareUpdate {
  mode: CardShareMode;
  password?: string;
  // Move the link to a different owner: "user" stays under the sharer's username, "org" lives under
  // a workspace. orgId is required for "org" and forbidden for "user". slug is the new tail segment.
  owner?: AppOwner;
  orgId?: string;
  slug?: string;
}

// The dialog's first paint, before the server answers: the share the app remembers (app.share), else a private one.
export function seedAppShareState(app: Pick<MiniApp, "url" | "share">, signedOut: boolean): AppShareState {
  const noOwners = { user: null, orgs: [] };
  if (signedOut) return { kind: "signed-out" };
  const memo = app.share;
  const shows: AppShareKind = app.url.startsWith("file:") ? "blob" : "site";
  if (!memo) {
    return {
      kind: "ok", id: null, url: null, mode: "private", hasPassword: false, shows,
      owner: null, slug: null, orgId: null, publicUrl: null, owners: noOwners, manifest: null, preview: null, previewing: false,
    };
  }
  return {
    kind: "ok", id: memo.id, url: memo.id ? appShareUrl(memo.id) : null, mode: memo.mode,
    hasPassword: memo.hasPassword, shows,
    owner: memo.owner ?? null, slug: memo.slug ?? null, orgId: memo.orgId ?? null,
    publicUrl: memo.url ?? null, owners: noOwners, manifest: null, preview: null, previewing: false,
  };
}

// What the viewer frames: a blob through the share's own page route (the #hash kept), a site at its address,
// a folder at its entry file (also under the share's page route) so relative URLs in the entry page
// resolve against /api/a/<id>/f/<path> for sibling files.
export function appFrameSrc(id: string, row: Pick<CloudAppShareRow, "kind" | "page">): string {
  if (row.kind === "site") return row.page;
  if (row.kind === "folder") {
    // The entry is the path inside the folder, e.g. "index.html"; the file route serves it.
    const entry = row.page || "index.html";
    return `/api/a/${id}/f/${entry}`;
  }
  const at = row.page.indexOf("#");
  return `/api/a/${id}/page${at < 0 ? "" : row.page.slice(at)}`;
}

// The sha a blob share serves, or null when the row isn't a well-formed blob.
export function appBlobSha(row: Pick<CloudAppShareRow, "kind" | "page">): string | null {
  if (row.kind !== "blob" || !row.page.startsWith(BLOB_REF_PREFIX)) return null;
  const sha = row.page.slice(BLOB_REF_PREFIX.length).replace(/#.*$/, "");
  return /^[0-9a-f]{64}$/.test(sha) ? sha : null;
}
