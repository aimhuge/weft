import { norm, shownFolders as pickFolders, type Tone } from "./db-picker";
import { folderName } from "./format";
import type { Card } from "./types";
import type { VaultTokenCandidate, VaultTokenPick, VaultTokenResult } from "./provider-vault-token";

// What the Supabase drawer shows, from what Electron main's Supabase side (electron/supabase.cjs) sends. The
// token never reaches the board: main keeps it in the Keychain and makes every call.

// A folder's link: just the ref until Supabase answers, then the project.
export interface SupabaseLink {
  ref: string;
  // "cli": supabase/.temp/project-ref (what `supabase link` writes); "mcp": the Supabase server in .mcp.json.
  source: "cli" | "mcp";
  name: string | null;
  org?: string | null;
  region?: string | null;
  // ACTIVE_HEALTHY, INACTIVE (paused), COMING_UP, RESTORING, …
  status?: string;
  // The project's API URL, https://<ref>.supabase.co.
  url?: string;
  // The folder's migrations Supabase hasn't applied, or null when it can't say.
  pending?: string[] | null;
  // Migrations Supabase applied under another version than the local file's (the MCP's apply_migration stamps
  // its own), matched by name: applied, but `supabase db push` would run them again until the file is renamed.
  drift?: MigrationDrift[];
}

export interface MigrationDrift {
  name: string;
  local: string;
  remote: string;
}

export interface SupabaseFolder {
  folder: string;
  // The folder's GitHub remote, owner/name.
  repo: string | null;
  // How many migrations the folder has in supabase/migrations.
  migrations: number;
  link: SupabaseLink | null;
  // Supabase couldn't read the linked project.
  error: string | null;
}

export interface SupabaseStatus {
  signedIn: boolean;
  // The organizations the token reaches, by name; null until it's checked.
  orgs: string[] | null;
  // The saved token didn't work.
  error: string | null;
  folders: SupabaseFolder[];
}

export interface SupabaseProject {
  ref: string;
  name: string;
  org: string | null;
  region: string | null;
  status: string;
  createdAt: number;
}

export interface SupabaseOrg {
  slug: string;
  name: string;
}

// What the New project form sends; main makes the database password.
export interface NewSupabaseProject {
  name: string;
  org: string;
  region: string;
}

// window.weft.supabase, from electron/preload.cjs.
export interface SupabaseBridge {
  status(folders: string[]): Promise<SupabaseStatus>;
  setToken(token: string): Promise<{ orgs: string[] }>;
  forgetToken(): Promise<{ signedIn: false }>;
  // A project vault's token, by name (lib/provider-vault-token.ts); missing in an older shell.
  vaultTokenCandidates?: (folders: string[]) => Promise<VaultTokenCandidate[]>;
  useVaultToken?: (pick: VaultTokenPick) => Promise<VaultTokenResult<{ orgs: string[] }>>;
  projects(): Promise<SupabaseProject[]>;
  orgs(): Promise<SupabaseOrg[]>;
  // secret: the vault name the database password went under.
  create(folder: string, project: NewSupabaseProject): Promise<{ ref: string; name: string; secret: string }>;
  link(folder: string, ref: string): Promise<{ linked: true; name: string }>;
  unlink(folder: string): Promise<{ linked: false }>;
  restore(ref: string): Promise<{ restoring: true }>;
}

export const TOKEN_URL = "https://supabase.com/dashboard/account/tokens";
export const NEW_PROJECT_URL = "https://supabase.com/dashboard/new";

// The regions a new project can go in, by the place a person would pick.
export const REGIONS: { code: string; label: string }[] = [
  { code: "us-east-1", label: "East US (N. Virginia)" },
  { code: "us-east-2", label: "East US (Ohio)" },
  { code: "us-west-1", label: "West US (N. California)" },
  { code: "us-west-2", label: "West US (Oregon)" },
  { code: "ca-central-1", label: "Canada (Central)" },
  { code: "sa-east-1", label: "South America (São Paulo)" },
  { code: "eu-west-1", label: "West EU (Ireland)" },
  { code: "eu-west-2", label: "West EU (London)" },
  { code: "eu-west-3", label: "West EU (Paris)" },
  { code: "eu-central-1", label: "Central EU (Frankfurt)" },
  { code: "eu-central-2", label: "Central EU (Zurich)" },
  { code: "eu-north-1", label: "North EU (Stockholm)" },
  { code: "ap-south-1", label: "South Asia (Mumbai)" },
  { code: "ap-southeast-1", label: "Southeast Asia (Singapore)" },
  { code: "ap-southeast-2", label: "Oceania (Sydney)" },
  { code: "ap-northeast-1", label: "Northeast Asia (Tokyo)" },
  { code: "ap-northeast-2", label: "Northeast Asia (Seoul)" },
  { code: "ap-east-1", label: "East Asia (Hong Kong)" },
];

// A new project's region: where most of your projects already are (ties to the newest), else East US.
export function defaultRegion(projects: Pick<SupabaseProject, "region" | "createdAt">[]) {
  const counts = new Map<string, number>();
  for (const p of [...projects].sort((a, b) => b.createdAt - a.createdAt)) {
    if (p.region && REGIONS.some((r) => r.code === p.region)) counts.set(p.region, (counts.get(p.region) ?? 0) + 1);
  }
  let best = "us-east-1";
  let most = 0;
  for (const [code, n] of counts) if (n > most) [best, most] = [code, n];
  return best;
}

// A new project's name: the repo's, else the folder's.
export function defaultProjectName(folder: Pick<SupabaseFolder, "folder" | "repo">) {
  return folder.repo?.split("/")[1] || folderName(folder.folder);
}

export function supabaseBridge(): SupabaseBridge | null {
  return (typeof window !== "undefined" && window.weft?.supabase) || null;
}

// The desktop shell started before Supabase was added: its preload has no bridge, or its main no handlers.
export function needsRestart(hasShell: boolean, bridge: SupabaseBridge | null, error: string | null) {
  return (hasShell && !bridge) || (!!error && error.includes("No handler registered for 'supabase:"));
}

// How well a project fits a folder: 2 has the repo's or folder's name, 1 a name that contains it either way, 0 none.
export function matchScore(project: Pick<SupabaseProject, "name">, folder: Pick<SupabaseFolder, "folder" | "repo">) {
  const names = [folderName(folder.folder), folder.repo?.split("/")[1] ?? ""].map(norm).filter(Boolean);
  const name = norm(project.name);
  if (names.includes(name)) return 2;
  if (name && names.some((n) => n.includes(name) || name.includes(n))) return 1;
  return 0;
}

// The picker's list: projects matching the search (name, org or ref), best fits for the folder first, then newest.
export function pickerList(projects: SupabaseProject[], folder: Pick<SupabaseFolder, "folder" | "repo">, search = "") {
  const q = search.trim().toLowerCase();
  return projects
    .filter((p) => !q || [p.name, p.org ?? "", p.ref].some((s) => s.toLowerCase().includes(q)))
    .map((p) => ({ project: p, score: matchScore(p, folder) }))
    .sort((a, b) => b.score - a.score || b.project.createdAt - a.project.createdAt);
}

const STATES: Record<string, { label: string; tone: Tone }> = {
  ACTIVE_HEALTHY: { label: "Healthy", tone: "ok" },
  ACTIVE_UNHEALTHY: { label: "Unhealthy", tone: "bad" },
  INACTIVE: { label: "Paused", tone: "muted" },
  COMING_UP: { label: "Starting", tone: "warn" },
  RESTORING: { label: "Restoring", tone: "warn" },
  RESTARTING: { label: "Restarting", tone: "warn" },
  UPGRADING: { label: "Upgrading", tone: "warn" },
  RESIZING: { label: "Resizing", tone: "warn" },
  PAUSING: { label: "Pausing", tone: "warn" },
  GOING_DOWN: { label: "Stopping", tone: "warn" },
  INIT_FAILED: { label: "Failed to start", tone: "bad" },
  RESTORE_FAILED: { label: "Restore failed", tone: "bad" },
  PAUSE_FAILED: { label: "Pause failed", tone: "bad" },
  REMOVED: { label: "Removed", tone: "bad" },
};

export function projectState(status: string) {
  return STATES[status] ?? { label: status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " "), tone: "muted" as const };
}

// The line about the folder's migrations: none, all applied, or how many Supabase hasn't run yet, with the first two
// names apart from the text so the drawer can link each to the card that wrote it (migrationOwner). `fix` is
// whether there's work for the Migrate card (lib/supabase-migrate.ts): something to apply, or a file out of step.
export function migrationLine(
  f: Pick<SupabaseFolder, "migrations">,
  link: Pick<SupabaseLink, "pending" | "drift">,
): { text: string; warn: boolean; names: string[]; more: boolean; fix: boolean } | null {
  if (!f.migrations) return null;
  const all = `${f.migrations} migration${f.migrations === 1 ? "" : "s"}`;
  const drift = link.drift?.length ?? 0;
  if (!link.pending) return { text: all, warn: false, names: [], more: false, fix: false };
  if (!link.pending.length) {
    if (!drift) return { text: `${all}, all applied`, warn: false, names: [], more: false, fix: false };
    return { text: `${all}, all applied; ${drift} under another version`, warn: true, names: [], more: false, fix: true };
  }
  const n = link.pending.length;
  return { text: `${n} of ${all} not applied`, warn: true, names: link.pending.slice(0, 2), more: n > 2, fix: true };
}

// The card that wrote a migration: the latest one whose edited files (Card.touchedFiles) hold the folder's
// supabase/migrations/<version>_<name>.sql.
export function migrationOwner<C extends Pick<Card, "touchedFiles" | "updatedAt">>(cards: C[], folder: string, name: string): C | undefined {
  const dir = `${folder.replace(/\/+$/, "")}/supabase/migrations/`;
  const wrote = (p: string) => p.startsWith(dir) && /^\d+_(.+)\.sql$/.exec(p.slice(dir.length))?.[1] === name;
  return cards.filter((c) => c.touchedFiles?.some(wrote)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

// The linked card's row of supabase.com shortcuts into the project's dashboard, short enough for one line.
export function supabaseActions(ref: string): { label: string; url: string }[] {
  const base = `https://supabase.com/dashboard/project/${ref}`;
  return [
    { label: "Auth", url: `${base}/auth/users` },
    { label: "Logs", url: `${base}/logs/explorer` },
    { label: "Keys", url: `${base}/settings/api-keys` },
    { label: "Usage", url: `${base}/settings/billing/usage` },
    { label: "Dash", url: base },
  ];
}

// The folders the drawer shows: the top bar's project only, or every one (lib/db-picker.ts).
export function shownFolders(folders: SupabaseFolder[], project: string | null) {
  return pickFolders(folders, project);
}

// Who the token is, under the drawer's header.
export function signedInLine(orgs: string[] | null) {
  if (!orgs?.length) return "Signed in";
  return orgs.length > 2 ? `Signed in · ${orgs.slice(0, 2).join(", ")} +${orgs.length - 2}` : `Signed in · ${orgs.join(", ")}`;
}

// Migrations not yet applied across the shown folders: the red count on the rail's bolt.
export function pendingCount(status: SupabaseStatus | null, project: string | null) {
  if (!status?.signedIn) return 0;
  return shownFolders(status.folders, project).reduce((n, f) => n + (f.link?.pending?.length ?? 0), 0);
}

// The rail icon's hover text.
export function supabaseTitle(status: SupabaseStatus | null, project: string | null) {
  if (!status?.signedIn) return "Supabase: link this project";
  const linked = shownFolders(status.folders, project).filter((f) => f.link);
  if (!linked.length) return "Supabase: not linked yet";
  const pending = pendingCount(status, project);
  return `Supabase: ${linked.map((f) => f.link?.name ?? f.link?.ref ?? folderName(f.folder)).join(", ")}${pending ? ` · ${pending} migration${pending === 1 ? "" : "s"} not applied` : ""}`;
}
