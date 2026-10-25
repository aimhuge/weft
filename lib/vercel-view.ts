import { norm, shownFolders as pickFolders, type Tone } from "./db-picker";
import { folderName } from "./format";

// What the ▲ drawer shows, from what Electron main's Vercel side (electron/vercel.cjs) sends. The token
// never reaches the board: main keeps it in the Keychain and makes every call.

export interface VercelDeployment {
  // READY, ERROR, BUILDING, QUEUED, INITIALIZING, CANCELED, or UNKNOWN when Vercel gives none.
  state: string;
  url: string | null;
  createdAt: number;
  target: string | null;
  // The deploy's page on vercel.com: its build logs, status and domains.
  page?: string | null;
}

// A folder's link: just the ids from .vercel/project.json until Vercel answers, then the project.
export interface VercelLink {
  projectId: string;
  orgId: string;
  name: string | null;
  team?: string | null;
  // The GitHub repo the project deploys from, owner/name.
  git?: string | null;
  url?: string | null;
  dashboard?: string;
  latest?: VercelDeployment | null;
}

export interface VercelFolder {
  folder: string;
  // The folder's GitHub remote, owner/name.
  repo: string | null;
  link: VercelLink | null;
  // Vercel couldn't read the linked project.
  error: string | null;
}

export interface VercelStatus {
  signedIn: boolean;
  user: { username: string } | null;
  // The saved token didn't work.
  error: string | null;
  folders: VercelFolder[];
}

export interface VercelProject {
  id: string;
  name: string;
  orgId: string;
  team: string;
  teamSlug: string | null;
  git: string | null;
  framework: string | null;
  updatedAt: number;
}

// Where a new project can go: a team, or your own account (id null).
export interface VercelScopes {
  scopes: { id: string | null; name: string }[];
  defaultId: string | null;
}

export interface CreateOptions {
  name: string;
  teamId: string | null;
  // Connect the folder's GitHub repo so pushes deploy.
  git: boolean;
}

export interface CreateResult {
  created: true;
  name: string;
  // The repo it now deploys from, or null.
  git: string | null;
  // Why connecting the repo failed; the project is made and linked anyway.
  gitError: string | null;
}

// window.weft.vercel, from electron/preload.cjs.
export interface VercelBridge {
  status(folders: string[]): Promise<VercelStatus>;
  setToken(token: string): Promise<{ username: string }>;
  forgetToken(): Promise<{ signedIn: false }>;
  projects(): Promise<VercelProject[]>;
  scopes(): Promise<VercelScopes>;
  link(folder: string, projectId: string, orgId: string): Promise<{ linked: true; name: string }>;
  create(folder: string, options: CreateOptions): Promise<CreateResult>;
  unlink(folder: string): Promise<{ linked: false }>;
  // Vault → Vercel (electron/vercel-env.cjs); missing on a main that started before env push was built.
  envStatus?: (folder: string) => Promise<VercelEnvStatus>;
  envPush?: (folder: string, name: string, environment: VercelEnvironment) => Promise<VercelPushResult>;
  // Every vault value, in every environment, behind one Touch ID (electron/vercel-env.cjs pushAll).
  // only: just these names and environments (the drift's Push), else everything.
  envPushAll?: (folder: string, only?: { name: string; environment: VercelEnvironment }[]) => Promise<VercelPushAllResult>;
  // The vault ⇄ Vercel drift from main's cached lists (lib/vercel-drift.ts), and when a background fetch lands.
  envDrift?: (folders: string[]) => Promise<(VercelEnvStatus & { folder: string })[]>;
  onDrift?: (callback: (folder: string) => void) => () => void;
  // Vercel → vault: every plain variable the vault has no value for (electron/vercel-env.cjs pull).
  envPull?: (folder: string) => Promise<VercelPullResult>;
}

export type VercelEnvironment = "development" | "preview" | "production";

// One vault name in one environment, lined up with the linked project's variables (names only, never values).
export interface VercelEnvRow {
  name: string;
  environment: VercelEnvironment;
  // The vault has a value for it (not just the name).
  inVault: boolean;
  onVercel: boolean;
  // Not in the vault, and Vercel will hand its value back (plain or encrypted, not sensitive): Pull brings it down.
  pullable?: boolean;
}

export interface VercelEnvStatus {
  // The vault's name (owner/repo) and the Vercel project's.
  label: string;
  project: string;
  rows: VercelEnvRow[];
}

export interface VercelPushResult {
  pushed?: boolean;
  project?: string;
  denied?: boolean;
  missing?: boolean;
  label: string;
}

type EnvName = { name: string; environment: VercelEnvironment };

export interface VercelPushAllResult {
  label: string;
  project: string;
  denied?: boolean;
  sent?: EnvName[];
  // Vercel turned these down; the rest still went.
  failed?: (EnvName & { error: string })[];
}

export interface VercelPullResult {
  label: string;
  project: string;
  pulled: { name: string; environment: VercelEnvironment }[];
  // On Vercel and not in the vault, but sensitive, so Vercel won't hand the value back.
  skipped: { name: string; environment: VercelEnvironment }[];
}

export const ENV_SHORT: Record<VercelEnvironment, string> = { development: "dev", preview: "preview", production: "prod" };

// Rows the vault can push: it has the value and Vercel doesn't have the name there yet.
export const toPush = (rows: VercelEnvRow[]) => rows.filter((r) => r.inVault && !r.onVercel);

// The env section's one-line summary.
export function envLine(rows: VercelEnvRow[]) {
  const push = toPush(rows).length;
  const both = rows.filter((r) => r.inVault && r.onVercel).length;
  if (!rows.some((r) => r.inVault)) return "No vault values to push yet";
  if (!push) return `All ${both} vault ${both === 1 ? "secret is" : "secrets are"} on Vercel`;
  return `${push} to push${both ? ` · ${both} on Vercel` : ""}`;
}

// Rows Pull would bring down.
export const toPull = (rows: VercelEnvRow[]) => rows.filter((r) => r.pullable);

// The toast after a pull: what came down, and what has to be added by hand.
export function pullText(r: VercelPullResult) {
  const names = (list: { name: string }[]) => [...new Set(list.map((e) => e.name))].join(", ");
  const got = r.pulled.length ? `Pulled ${names(r.pulled)} into the ${r.label} vault` : `Nothing new to pull from ${r.project}`;
  return r.skipped.length ? `${got}. Sensitive on Vercel, add by hand: ${names(r.skipped)}` : got;
}

// The toast after a push, or why it didn't happen.
export function pushText(name: string, environment: VercelEnvironment, r: VercelPushResult) {
  if (r.denied) return `${name} stayed in the vault: Touch ID wasn't approved`;
  if (r.missing) return `${name} has no ${environment} value in the ${r.label} vault`;
  return `Pushed ${name} to ${r.project ?? "Vercel"} (${environment}). It's live from the next deploy`;
}

// The toast after Push all.
export function pushAllText(r: VercelPushAllResult) {
  if (r.denied) return "Nothing pushed: Touch ID wasn't approved";
  const sent = r.sent?.length ?? 0;
  const failed = r.failed ?? [];
  const got = sent ? `Pushed ${sent} ${sent === 1 ? "secret" : "secrets"} to ${r.project}. Live from the next deploy` : `Nothing pushed to ${r.project}`;
  return failed.length ? `${got}. Failed: ${failed.map((f) => `${f.name} (${ENV_SHORT[f.environment]}): ${f.error}`).join("; ")}` : got;
}

export const TOKEN_URL = "https://vercel.com/account/tokens";

export function vercelBridge(): VercelBridge | null {
  return (typeof window !== "undefined" && window.weft?.vercel) || null;
}

// How well a project fits a folder: 3 deploys from its GitHub repo, 2 has the repo's or folder's name,
// 1 a name that contains it either way, 0 none. The picker's score (components/VercelPicker.tsx) and its tests.
export function matchScore(project: Pick<VercelProject, "name" | "git">, folder: Pick<VercelFolder, "folder" | "repo">) {
  if (project.git && folder.repo && project.git.toLowerCase() === folder.repo.toLowerCase()) return 3;
  const names = [folderName(folder.folder), folder.repo?.split("/")[1] ?? ""].map(norm).filter(Boolean);
  const name = norm(project.name);
  if (names.includes(name)) return 2;
  if (name && names.some((n) => n.includes(name) || name.includes(n))) return 1;
  return 0;
}

// The picker's list: projects matching the search (name, team or repo), best fits for the folder first,
// then the most recently updated. Kept here so the picker stays self-contained; components/VercelPicker.tsx
// shares the same loop through lib/db-picker.ts.
export function pickerList(projects: VercelProject[], folder: Pick<VercelFolder, "folder" | "repo">, search = "") {
  const q = search.trim().toLowerCase();
  return projects
    .filter((p) => !q || [p.name, p.team, p.git ?? ""].some((s) => s.toLowerCase().includes(q)))
    .map((p) => ({ project: p, score: matchScore(p, folder) }))
    .sort((a, b) => b.score - a.score || b.project.updatedAt - a.project.updatedAt);
}

const STATES: Record<string, { label: string; tone: Tone }> = {
  READY: { label: "Ready", tone: "ok" },
  ERROR: { label: "Failed", tone: "bad" },
  BUILDING: { label: "Building", tone: "warn" },
  QUEUED: { label: "Queued", tone: "warn" },
  INITIALIZING: { label: "Starting", tone: "warn" },
  CANCELED: { label: "Canceled", tone: "muted" },
};

export function deployState(state: string) {
  return STATES[state] ?? { label: state.charAt(0) + state.slice(1).toLowerCase(), tone: "muted" as const };
}

// The line under a linked project about its GitHub repo: connected, connected to another repo, or not.
export function gitLine(link: Pick<VercelLink, "git">, repo: string | null): { text: string; warn: boolean } {
  if (!link.git) return { text: repo ? `Not deploying from GitHub (${repo})` : "Not deploying from GitHub", warn: true };
  if (repo && link.git.toLowerCase() !== repo.toLowerCase()) return { text: `Deploys from ${link.git}, not ${repo}`, warn: true };
  return { text: `Deploys from ${link.git}`, warn: false };
}

// The linked card's row of vercel.com shortcuts: the latest deploy's page, then the project's runtime logs,
// env vars, domains and dashboard. Only the dashboard when it's the generic one (no team or username).
export function vercelActions(link: Pick<VercelLink, "dashboard" | "latest">): { label: string; url: string }[] {
  const { dashboard, latest } = link;
  const actions = latest?.page ? [{ label: "Deploy", url: latest.page }] : [];
  if (!dashboard) return actions;
  if (!dashboard.endsWith("/dashboard"))
    actions.push(
      { label: "Logs", url: `${dashboard}/logs` },
      { label: "Env", url: `${dashboard}/settings/environment-variables` },
      { label: "Domains", url: `${dashboard}/settings/domains` },
    );
  return [...actions, { label: "Dashboard", url: dashboard }];
}

// The folders the drawer shows: the top bar's project only, or every one (lib/db-picker.ts).
export function shownFolders(folders: VercelFolder[], project: string | null) {
  return pickFolders(folders, project);
}

// A new project's suggested name: the GitHub repo's name, else the folder's, as Vercel takes names.
export function projectNameFor(folder: Pick<VercelFolder, "folder" | "repo">) {
  const base = folder.repo?.split("/")[1] || folderName(folder.folder);
  return base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{3,}/g, "--")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
}

// What Vercel takes as a project name (electron/vercel.cjs checks it again).
export const validProjectName = (name: string) => /^(?!.*---)[a-z0-9._-]{1,100}$/.test(name.trim());

// The scope the form starts on: your default team, else the first one there is.
export function startScope(s: VercelScopes) {
  return s.scopes.some((x) => x.id === s.defaultId) ? s.defaultId : (s.scopes[0]?.id ?? null);
}

// What the toast says after Create.
export function createdText(folder: string, result: CreateResult) {
  const made = `Made ${result.name} on Vercel and linked ${folderName(folder)}`;
  if (result.gitError) return `${made}, but couldn't connect GitHub: ${result.gitError}`;
  return result.git ? `${made}; pushes to ${result.git} deploy it` : made;
}

// The rail icon's hover text.
export function vercelTitle(status: VercelStatus | null, project: string | null) {
  if (!status?.signedIn) return "Vercel: link this project";
  const linked = shownFolders(status.folders, project).filter((f) => f.link);
  if (!linked.length) return "Vercel: not linked yet";
  return `Vercel: ${linked.map((f) => f.link?.name ?? folderName(f.folder)).join(", ")}`;
}
