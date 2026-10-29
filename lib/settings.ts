import { publish } from "./bus";
import { GOOSE_PROVIDERS } from "./goose-provider";
import { namedModels } from "./goose-models";
import { DEFAULT_LANDING, workflowOf } from "./issue-landing";
import { MODES, type Automation, type Backend, type PermissionMode, type Project, type SettingsView } from "./types";
import type { IssueWorkflow } from "./types-settings";
import { projectOpened } from "./project-open";
import { DEFAULT_MAX_THREADS, MAX_THREADS_CEILING } from "./settings-shared";
import { marked, touched, type ProjectMarks } from "./project-list";
import { isSubagentModel, type SubagentModel } from "./subagents";
import { DEFAULT_THREAD_PROMPT } from "./thread-prompt";
import { isEmpty, readSetting, save, settings, writeSetting } from "./settings-store";
import {
  backupModel,
  copilotModel,
  doneEffort,
  doneModel,
  reviewAllModel,
  setBackupModel,
  setCopilotModel,
  setDoneEffort,
  setDoneModel,
  setReviewAllModel,
} from "./settings-models";

// The default thread instructions live in lib/thread-prompt.ts; settings re-exports them for its callers.
export { DEFAULT_THREAD_PROMPT };

// The model picks (Settings → Models) live in lib/settings-models.ts; settings re-exports them, the
// way lib/types.ts fronts lib/types-*.ts, so their callers keep one import.
export {
  backupModel,
  copilotModel,
  doneEffort,
  doneModel,
  reviewAllModel,
  setBackupModel,
  setCopilotModel,
  setDoneEffort,
  setDoneModel,
  setReviewAllModel,
};

const MAX_PROJECTS = 40;

// What a new install starts with: moving a card to Done wraps it up with Weft's done skill.
const DEFAULT_AUTOMATIONS: Automation[] = [{ id: "default-done", on: "done", skill: "weft:done" }];

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
// The bounds live with the menu that offers them (lib/settings-shared.ts); settings re-exports them, so
// their callers keep one import.
export { DEFAULT_MAX_THREADS, MAX_THREADS_CEILING };

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

// The models the user gave a name to, so a model menu shows a name instead of a raw id
// (lib/goose-models.ts owns the setting and its validator). The board's model picker reads them
// from the settings view rather than importing lib/goose-models.ts, which reads the settings file
// off disk and so can't run in the browser.
export function gooseNamedModels(): { id: string; name: string }[] {
  return namedModels();
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

// Where a folder's issue cards land and how a "run" card works (lib/issue-landing.ts): the landing,
// plus the validation skill and the agent when the folder named them.
export function issueWorkflow(folder: string): IssueWorkflow {
  return workflowOf(settings().issueLandings?.[folder]);
}

// The landing for each folder that has one. A folder that's absent reads as "backlog" (issueWorkflow).
export function issueLandings(): Record<string, IssueWorkflow> {
  const out: Record<string, IssueWorkflow> = {};
  for (const [folder, value] of Object.entries(settings().issueLandings ?? {})) {
    const w = workflowOf(value);
    // A folder that only ever chose the default isn't worth a row.
    if (w.landing !== DEFAULT_LANDING || w.skill || w.agent) out[folder] = w;
  }
  return out;
}

export function setIssueWorkflow(folder: string, workflow: IssueWorkflow) {
  const s = settings();
  const w = workflowOf(workflow);
  // The default isn't stored, so settings.json holds only what differs from it. A folder that chose
  // only the default is left out of the map entirely.
  const map: Record<string, IssueWorkflow> = {};
  for (const [key, value] of Object.entries(s.issueLandings ?? {})) {
    if (key !== folder) map[key] = workflowOf(value);
  }
  if (w.landing !== DEFAULT_LANDING || w.skill || w.agent) map[folder] = w;
  s.issueLandings = Object.keys(map).length ? map : undefined;
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

// Marks a project folder as just used, adding it to the recent list if it's new (lib/project-list.ts).
export function touchProject(folder: string) {
  const fresh = !settings().projects.some((p) => p.path === folder);
  updateProjects((list) => touched(list, folder, Date.now(), MAX_PROJECTS));
  // A folder new to the list: whatever looks at a project once it lands (lib/project-open.ts), on a later tick.
  if (fresh) projectOpened(folder);
}

// Pins or hides a project, from its right-click menu (lib/project-menu.ts).
export function markProject(folder: string, marks: ProjectMarks) {
  updateProjects((list) => marked(list, folder, marks));
}

export function removeProject(folder: string) {
  updateProjects((list) => list.filter((p) => p.path !== folder));
}

// Changes the saved project list, saves it and tells the board.
function updateProjects(change: (projects: Project[]) => Project[]) {
  const s = settings();
  s.projects = change(s.projects);
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
    gooseNamedModels: gooseNamedModels(),
    projects: listProjects(),
    issueFolders: issueFolders(),
    issueLandings: issueLandings(),
    syncFolders: syncFolders(),
    allowedFolders: allowedFolders(),
  };
}
