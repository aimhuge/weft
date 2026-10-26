import fs from "node:fs";
import path from "node:path";
import { publish } from "./bus";
import { DATA_DIR } from "./store";
import { backendFor, EFFORTS } from "./new-thread";
import { GOOSE_PROVIDERS } from "./goose-provider";
import { MODES, type Automation, type Backend, type Effort, type PermissionMode, type Project, type SettingsView } from "./types";
import { globalSingleton } from "./global-singleton";
import { projectOpened } from "./project-open";
import { isSubagentModel, type SubagentModel } from "./subagents";
import { DEFAULT_THREAD_PROMPT } from "./thread-prompt";

// The default thread instructions live in lib/thread-prompt.ts; settings re-exports them for its callers.
export { DEFAULT_THREAD_PROMPT };

const MAX_PROJECTS = 40;

// What a new install starts with: moving a card to Done wraps it up with Weft's done skill.
const DEFAULT_AUTOMATIONS: Automation[] = [{ id: "default-done", on: "done", skill: "weft:done" }];

interface Settings {
  threadPrompt?: string;
  keepAliveMinutes?: number;
  // The mode a new thread starts in; unset means Auto.
  defaultPermissionMode?: PermissionMode;
  // The CLI new threads start on; unset means Claude (preserves the prior default).
  defaultBackend?: Backend;
  // Unset means the defaults; an empty list means the user removed them all.
  automations?: Automation[];
  // Whether /weft:done pushes after it commits cleanly; unset means on. Its push.sh reads this file.
  pushOnDone?: boolean;
  // The model board threads' subagents run on; unset means the thread picks per subagent (lib/subagents.ts).
  subagentModel?: SubagentModel;
  // The model /weft:done runs on; "" means use the card's own model. Applies to cards on the CLI that serves it
  // (the done skill's puku-agent fan-out is unchanged). See lib/automations.ts doneOverrides.
  doneModel?: string;
  // The effort /weft:done runs on; "" means use the card's own effort.
  doneEffort?: Effort;
  // The model the copilot starts on; "" means use the user's last-picked Claude model (lib/copilot.ts).
  // The copilot is one long-lived thread (id: "copilot", role: "copilot") and is locked to Claude Code.
  copilotModel?: string;
  // The Claude model the Review column's "Review all" card runs on; "" means the default (components/Board.tsx).
  reviewAllModel?: string;
  // The model the first-message-failed banner reruns the card on, in a fresh session of the same CLI.
  // "" means "no backup set": the banner button reads "Pick a backup model" and opens Settings → Models.
  // Any model id one of the installed CLIs serves is allowed; the rerun normalizes through modelOn.
  backupModel?: string;
  // The Goose provider whose key and env a Goose thread runs on (lib/goose-provider.ts). The key
  // itself lives in Electron main's Keychain; only the provider's id is a board-side setting.
  gooseProviderId?: string;
  // The model id a new Goose thread runs on; "" means the provider's own default.
  gooseModelId?: string;
  // The endpoint the providers that need one use (custom, azure, litellm); "" means none.
  gooseBaseUrl?: string;
  projects: Project[];
  // Claude Code sessions whose cards were deleted, so syncing doesn't bring them back.
  dismissedSessions?: string[];
  // Project folders whose open GitHub issues become Backlog cards (lib/github-issues.ts).
  issueFolders?: string[];
  // Project folders whose cards sync to the cloud (lib/cloud-sync.ts). Off by default.
  syncFolders?: string[];
  // Folders outside a card's project that every thread may use without asking (lib/folder-guard.ts), granted with "Always".
  allowedFolders?: string[];
  // Ready-made worktrees kept per repo for isolated cards (lib/worktree-pool.ts); unset means 1, 0 turns the pool off.
  worktreePool?: number;
  // The most threads running a turn at once; unset means DEFAULT_MAX_THREADS, 0 means no limit (lib/thread-slots.ts).
  maxThreads?: number;
}

const FILE = path.join(DATA_DIR, "settings.json");
function settings(): Settings {
  return globalSingleton("__weftSettings", () => {
    const saved = fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<Settings>) : {};
    return {
      threadPrompt: saved.threadPrompt,
      keepAliveMinutes: saved.keepAliveMinutes,
      defaultPermissionMode: saved.defaultPermissionMode,
      defaultBackend: saved.defaultBackend,
      automations: saved.automations,
      pushOnDone: saved.pushOnDone,
      subagentModel: saved.subagentModel,
      doneModel: saved.doneModel,
      doneEffort: saved.doneEffort,
      copilotModel: saved.copilotModel,
      reviewAllModel: saved.reviewAllModel,
      backupModel: saved.backupModel,
      gooseProviderId: saved.gooseProviderId,
      gooseModelId: saved.gooseModelId,
      gooseBaseUrl: saved.gooseBaseUrl,
      projects: saved.projects ?? [],
      dismissedSessions: saved.dismissedSessions ?? [],
      issueFolders: saved.issueFolders ?? [],
      syncFolders: saved.syncFolders ?? [],
      allowedFolders: saved.allowedFolders ?? [],
      worktreePool: saved.worktreePool,
      maxThreads: saved.maxThreads,
    };
  });
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings(), null, 2));
}

// The shape almost every getter below has: read the saved value, accept it only if `valid`, else the
// fallback. A settings.json can be hand-edited or written by an older build, so a value that no longer
// type-checks has to fall back rather than flow into the UI. `fallback` is what an absent or invalid
// value reads as, and it is deliberately allowed to be wider than the stored type: several of these
// settings store their default as "" at read time but as absent on disk (see writeSetting).
function readSetting<K extends keyof Settings, V>(key: K, valid: (v: Settings[K]) => v is NonNullable<Settings[K]>, fallback: V): NonNullable<Settings[K]> | V {
  const saved = settings()[key];
  return valid(saved) ? saved : fallback;
}

// The matching write: store `value`, or `undefined` when it means "the default" — so settings.json holds
// only what differs from the default, and a setting reset to its default leaves no residue behind. The
// empty-string case matters: several settings take "" as their explicit default (setDoneEffort takes
// `Effort | ""`), and writing it as undefined (or the reverse) is the bug that made a reset setting look
// like it had persisted. V is therefore allowed to be wider than the stored type; `isDefault` is what
// narrows it, and TS needs the assertion because it can't follow that through a boolean.
function writeSetting<V>(key: keyof Settings, value: V, isDefault: (v: V) => boolean) {
  // Assigned as undefined rather than deleted: JSON.stringify drops an undefined property, so
  // settings.json still records only what differs from the default.
  const next: Settings[keyof Settings] = isDefault(value) ? undefined : (value as Settings[keyof Settings]);
  Object.assign(settings(), { [key]: next });
  save();
}

// The "no override" rule shared by the model and effort overrides below: "" is their default, and it's
// stored as unset so settings.json records only what differs from the default.
const isEmpty = (v: string) => v === "";

export function threadPrompt() {
  return settings().threadPrompt?.trim() || DEFAULT_THREAD_PROMPT;
}

// Empty text goes back to the default.
export function setThreadPrompt(text: string) {
  settings().threadPrompt = text.trim() || undefined;
  save();
}

// 0 (the default) keeps conversations open until the app quits.
export function keepAliveMinutes() {
  return settings().keepAliveMinutes ?? 0;
}

export function setKeepAliveMinutes(minutes: number) {
  // At most a week; 0 means until the app quits.
  settings().keepAliveMinutes = Math.min(7 * 24 * 60, Math.max(0, Math.round(minutes)));
  save();
}

// How many ready worktrees the pool keeps per recently isolated repo: 0 to 3, 1 when unset.
export function worktreePoolSize(): number {
  return readSetting("worktreePool", (v): v is number => typeof v === "number" && v >= 0 && v <= 3, 1);
}

export function setWorktreePoolSize(n: number) {
  writeSetting("worktreePool", Math.min(3, Math.max(0, Math.round(n))), (v) => v === 1);
}

// How many threads may run a turn at once before the next waits for a free slot: 0 to 50, 0 for no limit.
export const DEFAULT_MAX_THREADS = 6;
export const MAX_THREADS_CEILING = 50;

export function maxThreads(): number {
  return readSetting("maxThreads", (v): v is number => typeof v === "number" && v >= 0 && v <= MAX_THREADS_CEILING, DEFAULT_MAX_THREADS);
}

export function setMaxThreads(n: number) {
  writeSetting("maxThreads", Math.min(MAX_THREADS_CEILING, Math.max(0, Math.round(n))), (v) => v === DEFAULT_MAX_THREADS);
}

export function defaultPermissionMode(): PermissionMode {
  return readSetting("defaultPermissionMode", (v): v is PermissionMode => !!v && MODES.includes(v), "auto");
}

export function setDefaultPermissionMode(mode: PermissionMode) {
  settings().defaultPermissionMode = mode;
  save();
}

export function defaultBackend(): Backend {
  return settings().defaultBackend ?? "claude";
}

export function setDefaultBackend(backend: Backend) {
  settings().defaultBackend = backend;
  save();
}

export function automations(): Automation[] {
  return settings().automations ?? DEFAULT_AUTOMATIONS;
}

export function setAutomations(list: Automation[]) {
  settings().automations = list;
  save();
}

export function pushOnDone() {
  return settings().pushOnDone ?? true;
}

export function setPushOnDone(on: boolean) {
  settings().pushOnDone = on;
  save();
}

export function subagentModel(): SubagentModel {
  return readSetting("subagentModel", isSubagentModel, "choose");
}

// "choose" is the default, so it's stored as unset.
export function setSubagentModel(model: SubagentModel) {
  writeSetting("subagentModel", model, (v) => v === "choose");
}

// Any model either CLI serves; it applies to cards on that CLI (lib/automations.ts doneOverrides).
// "" means use the card's own model.
function isDoneModel(value: unknown): value is string {
  return value === "" || (typeof value === "string" && backendFor(value) !== undefined);
}

// "" is the default, so the setting reads as "use the card's own model".
export function doneModel(): string {
  return readSetting("doneModel", isDoneModel, "");
}

// Empty string restores the default (no override).
export function setDoneModel(model: string) {
  writeSetting("doneModel", model, isEmpty);
}

// The stored value is an Effort id or absent (setDoneEffort stores "" as unset), so this only has to
// recognise a real id; "" is the read-time fallback, not something settings.json can hold.
function isDoneEffort(value: unknown): value is Effort {
  return EFFORTS.some((e) => e.id === value);
}

// "" is the default ("use the card's own effort").
export function doneEffort(): Effort | "" {
  return readSetting("doneEffort", isDoneEffort, "");
}

export function setDoneEffort(effort: Effort | "") {
  writeSetting("doneEffort", effort, isEmpty);
}

// The copilot is one long-lived thread (lib/copilot.ts), so its model is any model a CLI serves;
// picking one moves the copilot's CLI to the one that serves it. "" means "use the user's
// last-picked model" (lib/new-thread.ts modelFor).
function isCopilotModel(value: unknown): value is string {
  return value === "" || (typeof value === "string" && backendFor(value) !== undefined);
}

export function copilotModel(): string {
  return readSetting("copilotModel", isCopilotModel, "");
}

export function setCopilotModel(model: string) {
  writeSetting("copilotModel", model, isEmpty);
}

// "Review all" starts a card, so its model is any model a CLI serves. "" means the CLI's default.
export function reviewAllModel(): string {
  return readSetting("reviewAllModel", isCopilotModel, "");
}

export function setReviewAllModel(model: string) {
  writeSetting("reviewAllModel", model, isEmpty);
}

// The first-message-failed banner's backup model: any model any installed CLI serves, or "" for "off".
// The rerun normalizes through lib/new-thread.ts modelOn, so a Claude id on a Puku card lands on Puku's
// default — that's a banner, not a model picker, and the normalization keeps the label honest.
function isBackupModel(value: unknown): value is string {
  return value === "" || (typeof value === "string" && backendFor(value) !== undefined);
}

// "" is the default ("no backup set"), so an unset value reads as off.
export function backupModel(): string {
  return readSetting("backupModel", isBackupModel, "");
}

export function setBackupModel(model: string) {
  writeSetting("backupModel", model, isEmpty);
}

// The Goose provider a Goose thread runs on: the one whose key and env the runner asks Electron
// main for (lib/goose-launch.ts). The key never comes here — only which provider is active.
// "" means none picked yet.
function isGooseProviderId(value: unknown): value is string {
  return typeof value === "string" && (value === "" || GOOSE_PROVIDERS.some((p) => p.id === value));
}

export function gooseProviderId(): string {
  return readSetting("gooseProviderId", isGooseProviderId, "");
}

// A provider the catalog doesn't know is refused, so the setting can only name a provider the
// board can actually configure. "" clears it.
export function setGooseProviderId(id: string) {
  // The guard narrows `id` to `never` on the failing branch (the check is exhaustive over the
  // catalog), so the name is read before the check rather than inside the message.
  const name = id;
  if (!isGooseProviderId(id)) throw new Error(`Goose doesn't know a provider called "${name}".`);
  writeSetting("gooseProviderId", id, isEmpty);
}

// The model a new Goose thread runs on: any id the provider serves, or "" for the provider's
// own default. The catalog's curated ids are the common ones; a provider that serves anything
// else takes a typed id, so this is only checked for being text.
function isGooseModelId(value: unknown): value is string {
  return typeof value === "string";
}

// "" is the default (the provider decides), so it's stored as unset.
export function gooseModelId(): string {
  return readSetting("gooseModelId", isGooseModelId, "");
}

export function setGooseModelId(model: string) {
  writeSetting("gooseModelId", model.trim(), isEmpty);
}

// The endpoint for the providers that need one (custom, azure, litellm). "" is the default:
// a provider that doesn't need an endpoint has none, and one that does asks for it.
export function gooseBaseUrl(): string {
  return readSetting("gooseBaseUrl", isGooseModelId, "");
}

export function setGooseBaseUrl(url: string) {
  writeSetting("gooseBaseUrl", url.trim(), isEmpty);
}

export function dismissedSessions(): string[] {
  return settings().dismissedSessions ?? [];
}

export function dismissSession(sessionId: string) {
  const s = settings();
  s.dismissedSessions = [...new Set([...(s.dismissedSessions ?? []), sessionId])];
  save();
}

// The folders that sync their GitHub issues, in the order they were turned on.
export function issueFolders(): string[] {
  return [...(settings().issueFolders ?? [])];
}

export function setIssueSync(folder: string, on: boolean) {
  const s = settings();
  const rest = (s.issueFolders ?? []).filter((f) => f !== folder);
  s.issueFolders = on ? [...rest, folder] : rest;
  save();
}

// The folders outside any project that threads may use without asking (lib/folder-guard.ts), in the order they were allowed.
export function allowedFolders(): string[] {
  return [...(settings().allowedFolders ?? [])];
}

export function allowFolder(folder: string) {
  const s = settings();
  s.allowedFolders = [...new Set([...(s.allowedFolders ?? []), folder])];
  save();
}

// Takes a folder back out of the always-allowed list, so threads ask about it again from now on. This is the
// way back from "Always" on a folder-guard prompt: granting was one-way until Settings → Security could show
// and revoke it, which left a folder trusted once trusted for good. A card that already holds the folder in its
// read scope keeps it for the turn it's in — a revoke stops new work, it doesn't retract a permission handed out.
export function unallowFolder(folder: string) {
  const s = settings();
  s.allowedFolders = (s.allowedFolders ?? []).filter((f) => f !== folder);
  save();
}

// The folders whose cards sync to the cloud (lib/cloud-sync.ts), in the order they were turned on. Off by default.
export function syncFolders(): string[] {
  return [...(settings().syncFolders ?? [])];
}

// Sync to the cloud is opt-in per folder (lib/cloud-sync.ts); the board's Settings → Sync page turns it on,
// and the per-folder switch on the same page turns it off. Folder list stays in the order they were turned on.
export function setSyncFolder(folder: string, on: boolean) {
  const s = settings();
  const rest = (s.syncFolders ?? []).filter((f) => f !== folder);
  s.syncFolders = on ? [...rest, folder] : rest;
  save();
}

export function listProjects(): Project[] {
  return [...settings().projects].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

// Marks a project folder as just used, adding it to the recent list if it's new.
export function touchProject(folder: string) {
  const s = settings();
  const fresh = !s.projects.some((p) => p.path === folder);
  s.projects = [{ path: folder, lastUsedAt: Date.now() }, ...s.projects.filter((p) => p.path !== folder)].slice(
    0,
    MAX_PROJECTS,
  );
  save();
  publish({ type: "projects", projects: listProjects() });
  // A folder new to the list: whatever looks at a project once it lands (lib/project-open.ts), on a later tick.
  if (fresh) projectOpened(folder);
}

export function removeProject(folder: string) {
  const s = settings();
  s.projects = s.projects.filter((p) => p.path !== folder);
  save();
  publish({ type: "projects", projects: listProjects() });
}

export function settingsView(): SettingsView {
  return {
    threadPrompt: threadPrompt(),
    defaultThreadPrompt: DEFAULT_THREAD_PROMPT,
    keepAliveMinutes: keepAliveMinutes(),
    maxThreads: maxThreads(),
    defaultPermissionMode: defaultPermissionMode(),
    defaultBackend: defaultBackend(),
    automations: automations(),
    pushOnDone: pushOnDone(),
    subagentModel: subagentModel(),
    doneModel: doneModel(),
    doneEffort: doneEffort(),
    copilotModel: copilotModel(),
    reviewAllModel: reviewAllModel(),
    backupModel: backupModel(),
    gooseProviderId: gooseProviderId(),
    gooseModelId: gooseModelId(),
    gooseBaseUrl: gooseBaseUrl(),
    projects: listProjects(),
    issueFolders: issueFolders(),
    syncFolders: syncFolders(),
    allowedFolders: allowedFolders(),
  };
}
