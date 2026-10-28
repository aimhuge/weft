import type { KeychainBridge } from "./keychain-audit-types";
import type { MenuItem } from "./card-menu";
import type { VaultOrg, VaultShared } from "./vault-shared";
import type { ImportScan } from "./vault-import";

export type { VaultOrg, VaultShared };
// The .env import's shape and the preview's rules (lib/vault-import.ts). Re-exported here so the
// callers keep one import for the vault's types.
export {
  defaultPicks,
  importGroups,
  importLabel,
  picksOf,
  pickKey,
  STATUS_LABEL,
  trackedWarning,
  type ImportFile,
  type ImportRow,
  type ImportScan,
} from "./vault-import";

// What the 🔐 drawer and its rail icon show, from what Electron main's vault (electron/vault.cjs) sends:
// names, environments and masked tails, never values. Values come back only from reveal, after Touch ID.

export type VaultEnvironment = "development" | "preview" | "production";

export interface VaultSecret {
  name: string;
  environment: VaultEnvironment;
  // A blank: the name with no value yet, put in by a thread (mcp__secrets__add_blank), .env.example or you.
  missing: boolean;
  // The value's last 4 characters, or "" when it's too short to show any.
  tail: string;
  updatedAt: string;
  // The file it was imported from, or who added it as a blank ("a thread").
  source?: string;
  // A blank's note on where to get its value, from the thread that added it.
  hint?: string;
}

export interface VaultSummary {
  id: string;
  // owner/name for a GitHub repo, or the folder's name.
  label: string;
  // The project folder it opened from, and every board folder of the same repo.
  folder: string;
  folders: string[];
  secrets: VaultSecret[];
  // Values in .env.local the vault doesn't hold yet (or holds differently). managed: Weft writes that file, so
  // these are your hand edits to it.
  nudge: { count: number; file: string; managed?: boolean } | null;
  // Weft writes the folder's .env.local from the vault (electron/env-writeback.cjs).
  managed?: boolean;
  // Set when the vault is shared with a workspace (docs/architecture/teams-vault.md); undefined for a local one.
  shared?: VaultShared;
}

export interface VaultOverview {
  vaults: VaultSummary[];
  // Within the few minutes one Touch ID covers.
  unlocked: boolean;
  // The workspaces the user is in, for the drawer's "Share this vault" offer. Missing when the
  // desktop is signed out or its shell is too old to know about teams.
  orgs?: VaultOrg[];
}

export type RevealResult = { value: string } | { denied: true } | { missing: true };

// A conflict on one secret: someone else wrote the row between your last read and your write
// (docs/architecture/teams-vault.md, "Push on change"). The drawer shows it on that secret's row
// and offers the two ways out — keep your edit, or take theirs.
//
// Everything here is metadata: who wrote the row, which name and environment, and the server's
// row_version (what a re-push expects). Never a value, never ciphertext.
export interface VaultConflict {
  name: string;
  environment: VaultEnvironment;
  // Who wrote it, as a display name ("Sam"). A member the log doesn't name says "A member".
  actor: string;
  // The server's current row_version: the expected version for a re-push of the user's own edit.
  rowVersion: number;
  // The server's row is a blank (no value yet): a rare conflict the drawer keeps silently.
  blank: boolean;
}

// What `bridge.set` answers. A conflict isn't saved: the server's row is kept, and the drawer
// shows the banner on that secret's row.
export type SetResult = { saved: true; queued?: boolean } | { saved: false; conflict: VaultConflict };

// window.weft.vault, from electron/preload.cjs.
// The grant and log calls are in lib/keychain-audit-types.ts.
export interface VaultBridge extends KeychainBridge {
  overview(folders: string[]): Promise<VaultOverview>;
  scan(folder: string): Promise<ImportScan>;
  import(folder: string, picks: { file: string; name: string }[]): Promise<{ imported: number }>;
  reveal(id: string, name: string, environment: string): Promise<RevealResult>;
  copy(id: string, name: string, environment: string): Promise<{ copied: true } | { denied: true } | { missing: true }>;
  set(folder: string, name: string, environment: string, value: string): Promise<SetResult>;
  // Adds the name with no value yet. Missing in older shells.
  addBlank?: (folder: string, name: string, environment: string) => Promise<{ label: string; filled: string[] }>;
  copyTo(id: string, name: string, environment: string, folder: string): Promise<{ copied: true; label: string; replaced: boolean } | { missing: true }>;
  remove(id: string, name: string, environment: string): Promise<{ removed: boolean }>;
  lock(): Promise<{ unlocked: false }>;
  // Takes over .env.local: writes it from the vault and keeps it in step. Missing in older shells.
  writeBack?(folder: string): Promise<WriteBackResult>;
  // Shares a local vault with a workspace for the first time. Missing in older shells.
  share?(folder: string, orgId: string, repo: string, label?: string): Promise<{ vaultId: string; repo: string; keyVersion: number; orgId: string }>;
  onChange?(callback: (folder: string) => void): () => void;
}

export type WriteBackResult = { written: true; file: string; gitignoreAdded: boolean } | { refused: string };

// What the toast says after Weft takes over .env.local, or why it didn't.
export function writeBackText(result: WriteBackResult) {
  if ("refused" in result) return `.env.local stays as it is: ${result.refused}`;
  return `Weft now writes ${result.file} from the vault${result.gitignoreAdded ? " (and added .env*.local to .gitignore)" : ""}.`;
}

// The import preview offers to manage .env.local when the project has one Weft doesn't manage yet: true (ticked)
// when it's offered, null when it isn't (a managed file, no file, or a shell too old to write it back).
export function canManage(scan: ImportScan, managed: boolean) {
  return !managed && scan.files.some((f) => f.file === ".env.local");
}

export function manageOffer(bridge: VaultBridge, scan: ImportScan, managed: boolean | undefined) {
  return bridge.writeBack && canManage(scan, Boolean(managed)) ? true : null;
}

// After an import with the offer ticked: Weft takes over .env.local and says how it went.
export async function takeOver(bridge: VaultBridge, folder: string, manage: boolean | null) {
  if (!manage || !bridge.writeBack) return null;
  return writeBackText(await bridge.writeBack(folder));
}

export const ENVIRONMENTS: { id: VaultEnvironment; label: string }[] = [
  { id: "development", label: "Development" },
  { id: "preview", label: "Preview" },
  { id: "production", label: "Production" },
];

// Ticks or unticks one environment, keeping ENVIRONMENTS' order.
export function toggleEnvironment(picked: VaultEnvironment[], env: VaultEnvironment): VaultEnvironment[] {
  return ENVIRONMENTS.map((e) => e.id).filter((id) => (id === env ? !picked.includes(id) : picked.includes(id)));
}

// The environments a name is in, in ENVIRONMENTS' order.
export function environmentsOf(secrets: { name: string; environment: VaultEnvironment }[], name: string): VaultEnvironment[] {
  return ENVIRONMENTS.map((e) => e.id).filter((id) => secrets.some((s) => s.name === name && s.environment === id));
}

// The drawer hides revealed values and locks again after this long without a click or a key.
export const IDLE_LOCK_MS = 3 * 60_000;

export const secretKey = (s: { name: string; environment: string }) => `${s.environment}\n${s.name}`;

// Secrets by environment, in development / preview / production order, empty environments left out. Blanks
// come first in each, so the ones to fill in sit at the top.
export function groupSecrets(secrets: VaultSecret[]) {
  return ENVIRONMENTS.map((env) => ({
    ...env,
    secrets: secrets.filter((s) => s.environment === env.id).sort((a, b) => Number(b.missing) - Number(a.missing) || a.name.localeCompare(b.name)),
  })).filter((g) => g.secrets.length > 0);
}

// The Add form's button. With no value typed (and a shell that can add blanks), it adds the name as a blank.
export function saveLabel(editing: { fixed: boolean; value: string; environments: VaultEnvironment[]; from?: VaultEnvironment }, canBlank: boolean) {
  if (editing.fixed) {
    const [only] = editing.environments;
    if (editing.environments.length > 1) return `Save to ${editing.environments.length} environments`;
    if (only && only !== editing.from) return `Move to ${ENVIRONMENTS.find((e) => e.id === only)?.label}`;
    return "Save";
  }
  const blank = canBlank && editing.value === "";
  const many = editing.environments.length > 1;
  if (blank) return many ? `Add ${editing.environments.length} blanks` : "Add blank";
  return many ? `Add to ${editing.environments.length} environments` : "Add to vault";
}

// A blank row's tooltip: who added it and where its value comes from.
export function blankTitle(s: { name: string; source?: string; hint?: string }) {
  return [`${s.name} has no value yet${s.source ? ` (added by ${s.source})` : ""}.`, s.hint, "Click Fill in to paste it."].filter(Boolean).join("\n");
}

export function masked(secret: { missing?: boolean; tail: string }) {
  if (secret.missing) return "blank";
  return `••••${secret.tail}`;
}

// The conflict banner's line: "Sam changed API_KEY in development — keep your edit?"
// (docs/architecture/teams-vault.md, "Push on change"). The actor's name, the secret's name and
// the environment; never a value.
export function conflictLine(conflict: { actor: string; name: string; environment: string }) {
  return `${conflict.actor} changed ${conflict.name} in ${conflict.environment} — keep your edit?`;
}

// The rail icon's count (blanks still to fill in) and dot (a .env.local to import).
export function railBadge(vaults: VaultSummary[]) {
  return {
    missing: vaults.reduce((n, v) => n + v.secrets.filter((s) => s.missing).length, 0),
    nudge: vaults.some((v) => v.nudge),
  };
}

export function railTitle(badge: { missing: number; nudge: boolean; vercel?: string }) {
  const parts = ["Secrets: this project's vault"];
  if (badge.missing) parts.push(`${badge.missing} blank${badge.missing === 1 ? "" : "s"} to fill in`);
  if (badge.nudge) parts.push(".env.local has values to import");
  // The vault ⇄ Vercel drift (lib/vercel-drift.ts driftBadge).
  if (badge.vercel) parts.push(badge.vercel);
  return parts.join(" · ");
}

export function nudgeText(nudge: { count: number; file: string; managed?: boolean }) {
  if (nudge.managed) return `You edited ${nudge.file}: import ${nudge.count === 1 ? "the change" : `${nudge.count} changes`} into the vault?`;
  return `Found ${nudge.count} secret${nudge.count === 1 ? "" : "s"} in ${nudge.file}: move ${nudge.count === 1 ? "it" : "them"} into the vault?`;
}

export type SecretAction = "reveal" | "copy" | "edit" | "remove" | `copy-to:${string}`;

// The right-click menu on a secret's row: reveal and copy (Touch ID), a new value, a copy into each of the
// board's other projects (one click each: menus have no submenus), and remove.
export function secretMenu(secret: { missing: boolean }, others: { folder: string; label: string }[] = []): MenuItem[] {
  const items: MenuItem[] = secret.missing
    ? [{ id: "edit", label: "Fill In Value…" }]
    : [{ id: "reveal", label: "Reveal Value" }, { id: "copy", label: "Copy Value" }, { id: "edit", label: "Change Value…" }];
  if (others.length) items.push({ type: "separator" }, ...others.map((o) => ({ id: `copy-to:${o.folder}`, label: `Copy to ${o.label}` })));
  items.push({ type: "separator" }, { id: "remove", label: "Remove from Vault…" });
  return items;
}

// What a .env file takes as a variable's name (electron/vault.cjs checks it again).
export const validName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

// The drawer's project filter follows the top bar's project until you pick another in the drawer; picking
// a new project in the top bar takes it back. null is every project.
export interface VaultFilterPick {
  // The top bar's project when you picked.
  top: string | null;
  folder: string | null;
}

export function vaultFilter(top: string | null, pick: VaultFilterPick | null): string | null {
  return pick && pick.top === top ? pick.folder : top;
}

// The vaults the filter shows: the one holding that folder (folders of one repo share a vault), or all.
export function filterVaults(vaults: VaultSummary[], folder: string | null) {
  if (!folder) return vaults;
  return vaults.filter((v) => v.folders.includes(folder));
}

// A thread asking for a key it's blocked on (mcp__secrets__ask_add): the thread shows an input for it in place of
// the tool call (components/SecretAskInput.tsx), so the user pastes the value where they're already reading.
export interface SecretAsk {
  folder: string;
  name: string;
  environment: VaultEnvironment;
}

// The ask in an mcp__secrets__ask_add call, read by lib/runner-turn.ts as the call arrives; folder is the
// card's own unless the call names another project. undefined for any other tool or a malformed call.
export function secretAskOf(tool: string, input: Record<string, unknown>, cwd: string): SecretAsk | undefined {
  if (tool !== "mcp__secrets__ask_add" || typeof input.name !== "string" || !validName(input.name)) return undefined;
  const environment = ENVIRONMENTS.find((e) => e.id === input.environment)?.id ?? "development";
  return { folder: typeof input.project === "string" && input.project ? input.project : cwd, name: input.name, environment };
}

// Whether the ask's name has a value in its folder's vault, for that environment.
export function askAnswered(vaults: VaultSummary[], ask: SecretAsk): boolean {
  const v = vaults.find((x) => x.folders.includes(ask.folder));
  return Boolean(v?.secrets.some((s) => s.name === ask.name && s.environment === ask.environment && !s.missing));
}

// The filter's choices: every project's vault by name, after "All projects".
export function filterOptions(vaults: VaultSummary[]) {
  return [{ folder: "", label: "All projects" }, ...vaults.map((v) => ({ folder: v.folder, label: v.label })).sort((a, b) => a.label.localeCompare(b.label))];
}

// What "Copy to" says when it's done.
export function copiedText(name: string, result: { label: string; replaced: boolean }) {
  return `${result.replaced ? "Replaced" : "Copied"} ${name} in ${result.label}`;
}

export function vaultBridge(): VaultBridge | null {
  return (typeof window !== "undefined" && window.weft?.vault) || null;
}
