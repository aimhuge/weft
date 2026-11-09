import { norm, shownFolders as pickFolders, type Tone } from "./db-picker";
import { folderName } from "./format";
import type { VaultTokenCandidate, VaultTokenPick, VaultTokenResult } from "./provider-vault-token";

// What the Cloudflare drawer shows, from what Electron main's Cloudflare side (electron/cloudflare.cjs) sends.
// The token never reaches the board: main keeps it in the Keychain and makes every call.

export type CloudflareKind = "worker" | "pages";

export interface CloudflareDeployment {
  // Pages: the last stage's status (success, failure, active, idle, canceled, skipped). Workers: deployed.
  state: string;
  // Pages: the last stage's name (queued, initialize, clone_repo, build, deploy).
  stage: string | null;
  url: string | null;
  createdAt: number;
  // production or preview.
  target: string | null;
  // Workers: what made the deployment (wrangler, dash, api, terraform…).
  source: string | null;
}

// A folder's link: what Weft saved until Cloudflare answers, then the project.
export interface CloudflareLink {
  kind: CloudflareKind;
  accountId: string;
  name: string;
  account?: string | null;
  // The repo a Pages project builds from, owner/name.
  git?: string | null;
  url?: string | null;
  dashboard?: string;
  latest?: CloudflareDeployment | null;
}

// The folder's wrangler config: the name it gives, and whether it's a Pages project.
export interface WranglerConfig {
  file: string;
  name: string | null;
  kind: CloudflareKind;
}

export interface CloudflareFolder {
  folder: string;
  // The folder's GitHub remote, owner/name.
  repo: string | null;
  wrangler: WranglerConfig | null;
  link: CloudflareLink | null;
  // Cloudflare couldn't read the linked project.
  error: string | null;
}

export interface CloudflareStatus {
  signedIn: boolean;
  // The account the token reaches (or the first, "+N" for more).
  user: { name: string } | null;
  // The saved token didn't work.
  error: string | null;
  folders: CloudflareFolder[];
}

export interface CloudflareProject {
  kind: CloudflareKind;
  name: string;
  accountId: string;
  account: string;
  git: string | null;
  updatedAt: number;
}

// window.weft.cloudflare, from electron/preload.cjs.
export interface CloudflareBridge {
  status(folders: string[]): Promise<CloudflareStatus>;
  setToken(token: string): Promise<TokenSaved>;
  forgetToken(): Promise<{ signedIn: false }>;
  // A project vault's token, by name (lib/provider-vault-token.ts); missing in an older shell.
  vaultTokenCandidates?: (folders: string[]) => Promise<VaultTokenCandidate[]>;
  useVaultToken?: (pick: VaultTokenPick) => Promise<VaultTokenResult<TokenSaved>>;
  projects(): Promise<CloudflareProject[]>;
  link(folder: string, kind: CloudflareKind, accountId: string, name: string): Promise<{ linked: true; name: string }>;
  unlink(folder: string): Promise<{ linked: false }>;
}

// What setToken answers: the account it reaches, and when you pasted a setup token, that Weft made its own
// token with it and whether the setup token is deleted.
export interface TokenSaved {
  name: string;
  made?: boolean;
  setupDeleted?: boolean;
}

export const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

// The toast after a token is saved. A setup token Weft couldn't delete is yours to delete.
export function tokenSavedLine(saved: TokenSaved) {
  const signedIn = `Signed in to Cloudflare: ${saved.name}`;
  if (!saved.made) return signedIn;
  if (saved.setupDeleted) return `${signedIn}. Weft made its own token and deleted the setup token.`;
  return `${signedIn}. Weft made its own token, but couldn't delete the setup token: delete it at dash.cloudflare.com/profile/api-tokens.`;
}

export function cloudflareBridge(): CloudflareBridge | null {
  return (typeof window !== "undefined" && window.weft?.cloudflare) || null;
}

// Weft's desktop shell is running, but from before Cloudflare: its preload has no bridge, or main has no
// handlers yet. Either way a restart turns it on.
export function needsRestart(bridge: CloudflareBridge | null, error: string | null) {
  if (!bridge) return typeof window !== "undefined" && Boolean(window.weft?.desktop);
  return !!error && error.includes("No handler registered for 'cloudflare:");
}

// How well a project fits a folder: 4 its wrangler config names it, 3 builds from its GitHub repo, 2 has the
// repo's or folder's name, 1 a name that contains it either way, 0 none.
export function matchScore(project: Pick<CloudflareProject, "name" | "git">, folder: Pick<CloudflareFolder, "folder" | "repo" | "wrangler">) {
  if (folder.wrangler?.name && folder.wrangler.name === project.name) return 4;
  if (project.git && folder.repo && project.git.toLowerCase() === folder.repo.toLowerCase()) return 3;
  const names = [folderName(folder.folder), folder.repo?.split("/")[1] ?? ""].map(norm).filter(Boolean);
  const name = norm(project.name);
  if (names.includes(name)) return 2;
  if (name && names.some((n) => n.includes(name) || name.includes(n))) return 1;
  return 0;
}

// The picker's list: projects matching the search (name, account, kind or repo), best fits first, then the
// most recently changed.
export function pickerList(projects: CloudflareProject[], folder: Pick<CloudflareFolder, "folder" | "repo" | "wrangler">, search = "") {
  const q = search.trim().toLowerCase();
  return projects
    .filter((p) => !q || [p.name, p.account, KIND_LABEL[p.kind], p.git ?? ""].some((s) => s.toLowerCase().includes(q)))
    .map((p) => ({ project: p, score: matchScore(p, folder) }))
    .sort((a, b) => b.score - a.score || b.project.updatedAt - a.project.updatedAt);
}

export const KIND_LABEL: Record<CloudflareKind, string> = { worker: "Worker", pages: "Pages" };

const STATES: Record<string, { label: string; tone: Tone }> = {
  deployed: { label: "Deployed", tone: "ok" },
  success: { label: "Ready", tone: "ok" },
  failure: { label: "Failed", tone: "bad" },
  active: { label: "Building", tone: "warn" },
  idle: { label: "Queued", tone: "warn" },
  canceled: { label: "Canceled", tone: "muted" },
  skipped: { label: "Skipped", tone: "muted" },
};

export function deployState(state: string) {
  return STATES[state] ?? { label: state.charAt(0).toUpperCase() + state.slice(1), tone: "muted" as const };
}

// The words after a deploy's state: where it went, or for a Worker what made it.
export function deployWhere(d: Pick<CloudflareDeployment, "target" | "source">) {
  if (d.source) return `via ${d.source}`;
  return d.target === "production" ? "production" : "preview";
}

// The line under a linked project about its source: the repo a Pages project builds from (warning when it's
// another repo or none), or the Worker's wrangler config. null when there's nothing to say.
export function sourceLine(link: Pick<CloudflareLink, "kind" | "git" | "name">, folder: Pick<CloudflareFolder, "repo" | "wrangler">): { text: string; warn: boolean } | null {
  const { repo, wrangler } = folder;
  if (link.kind === "pages") {
    if (!link.git) return { text: "Uploaded directly, not built from Git", warn: false };
    if (repo && link.git.toLowerCase() !== repo.toLowerCase()) return { text: `Builds from ${link.git}, not ${repo}`, warn: true };
    return { text: `Builds from ${link.git}`, warn: false };
  }
  if (!wrangler) return null;
  if (wrangler.name && wrangler.name !== link.name) return { text: `${wrangler.file} names ${wrangler.name}, not ${link.name}`, warn: true };
  return { text: `Deploys with wrangler (${wrangler.file})`, warn: false };
}

// The linked card's row of dash.cloudflare.com shortcuts.
export function cloudflareActions(link: Pick<CloudflareLink, "kind" | "dashboard">): { label: string; url: string }[] {
  const { dashboard } = link;
  if (!dashboard) return [];
  const more =
    link.kind === "pages"
      ? [{ label: "Domains", url: `${dashboard}/domains` }]
      : [
          { label: "Deploys", url: `${dashboard}/deployments` },
          { label: "Logs", url: `${dashboard}/observability/logs` },
          { label: "Settings", url: `${dashboard}/settings` },
        ];
  return [...more, { label: "Dashboard", url: dashboard }];
}

// What an unlinked folder's line says: its wrangler config's name, else its repo, else nothing yet.
export function unlinkedLine(f: Pick<CloudflareFolder, "repo" | "wrangler">) {
  if (f.wrangler?.name) return `${f.wrangler.file} names ${f.wrangler.name}`;
  return f.repo ? `${f.repo} · not on Cloudflare yet` : "Not linked to Cloudflare";
}

// The folders the drawer shows: the top bar's project only, or every one (lib/db-picker.ts).
export function shownFolders(folders: CloudflareFolder[], project: string | null) {
  return pickFolders(folders, project);
}

// The rail icon's hover text.
export function cloudflareTitle(status: CloudflareStatus | null, project: string | null) {
  if (!status?.signedIn) return "Cloudflare: link this project";
  const linked = shownFolders(status.folders, project).flatMap((f) => (f.link ? [f.link.name] : []));
  return linked.length ? `Cloudflare: ${linked.join(", ")}` : "Cloudflare: not linked yet";
}
