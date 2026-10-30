import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";
import { globalSingleton } from "./global-singleton";
import type { Automation, Backend, Effort, PermissionMode, Project } from "./types";
import type { IssueWorkflow } from "./types-settings";
import type { SubagentModel } from "./subagents";

// The settings file on disk (~/.weft/settings.json) and the read/write pair every setting goes
// through. The settings themselves live beside this: lib/settings.ts holds them, and
// lib/settings-models.ts holds the model picks.

// What a settings.json holds. Every field is optional except the lists, which default to empty:
// the file only records what differs from the default, so an absent key means "the default".
export interface Settings {
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
  // The models the user gave a name to, so a model menu can show a name instead of a raw id
  // (lib/goose-models.ts). A list of { id, name } pairs; unset means none named.
  gooseNamedModels?: { id: string; name: string }[];
  projects: Project[];
  // Claude Code sessions whose cards were deleted, so syncing doesn't bring them back.
  dismissedSessions?: string[];
  // Project folders whose open GitHub issues become cards (lib/github-issues.ts).
  issueFolders?: string[];
  // Where each project's issue cards land, and how a "run" card works (lib/issue-landing.ts):
  // "backlog" (cold), "needs_you" (parked, waiting on a person) or "run" (the thread starts at once
  // and parks in Needs you when it asks something). A map of folder → workflow; a folder that's absent
  // reads as "backlog".
  issueLandings?: Record<string, IssueWorkflow>;
  // Project folders whose cards sync to the cloud (lib/cloud-sync.ts). Off by default.
  syncFolders?: string[];
  // Project folders whose new cards run on your Weft Worker instead of this machine (lib/worker-handoff.ts).
  workerFolders?: string[];
  // Folders outside a card's project that every thread may use without asking (lib/folder-guard.ts), granted with "Always".
  allowedFolders?: string[];
  // Ready-made worktrees kept per repo for isolated cards (lib/worktree-pool.ts); unset means 1, 0 turns the pool off.
  worktreePool?: number;
  // The most threads running a turn at once; unset means DEFAULT_MAX_THREADS, 0 means no limit (lib/thread-slots.ts).
  maxThreads?: number;
}

const FILE = path.join(DATA_DIR, "settings.json");

// The settings as they are in memory, read once and kept: the file is the truth, and a write
// goes straight back to it.
export function settings(): Settings {
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
      gooseNamedModels: saved.gooseNamedModels,
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

export function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings(), null, 2));
}

// The shape almost every getter has: read the saved value, accept it only if `valid`, else the
// fallback. A settings.json can be hand-edited or written by an older build, so a value that no longer
// type-checks has to fall back rather than flow into the UI. `fallback` is what an absent or invalid
// value reads as, and it is deliberately allowed to be wider than the stored type: several of these
// settings store their default as "" at read time but as absent on disk (see writeSetting).
export function readSetting<K extends keyof Settings, V>(key: K, valid: (v: Settings[K]) => v is NonNullable<Settings[K]>, fallback: V): NonNullable<Settings[K]> | V {
  const saved = settings()[key];
  return valid(saved) ? saved : fallback;
}

// The matching write: store `value`, or `undefined` when it means "the default" — so settings.json holds
// only what differs from the default, and a setting reset to its default leaves no residue behind. The
// empty-string case matters: several settings take "" as their explicit default (setDoneEffort takes
// `Effort | ""`), and writing it as undefined (or the reverse) is the bug that made a reset setting look
// like it had persisted. V is therefore allowed to be wider than the stored type; `isDefault` is what
// narrows it, and TS needs the assertion because it can't follow that through a boolean.
export function writeSetting<V>(key: keyof Settings, value: V, isDefault: (v: V) => boolean) {
  // Assigned as undefined rather than deleted: JSON.stringify drops an undefined property, so
  // settings.json still records only what differs from the default.
  const next: Settings[keyof Settings] = isDefault(value) ? undefined : (value as Settings[keyof Settings]);
  Object.assign(settings(), { [key]: next });
  save();
}

// The "no override" rule shared by the model and effort overrides: "" is their default, and it's
// stored as unset so settings.json records only what differs from the default.
export const isEmpty = (v: string) => v === "";
