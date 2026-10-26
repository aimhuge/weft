// Settings, permissions, logins and account types.

import type { Automation, Backend, PermissionMode } from "./types-card";

export type { Backend, PermissionMode, Automation };
export { BACKEND_LABELS, MODES, MODE_OPTIONS, permissionOptions, toPermissionMode } from "./types-card";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// The model board threads' subagents run on: "choose", "inherit", or a model id from MODELS
// (lib/new-thread.ts); isSubagentModel checks one (lib/subagents.ts).
//
// It lives here, not in lib/subagents.ts, because this file is part of the types graph the client
// imports (lib/types.ts). A type-only import of a runtime module still pulls that module into the
// client's module graph, and lib/subagents.ts reads the settings file — node:fs — which a browser
// chunk can't hold, so the whole board failed to compile.
export type SubagentModel = string;

// What each setting holds: one list of the fields, so the patch the client sends, the patch the
// route reads and the view it answers with can't drift apart. A field added here reaches all three.
export interface SettingsFields {
  threadPrompt: string;
  keepAliveMinutes: number;
  maxThreads: number;
  defaultPermissionMode: PermissionMode;
  defaultBackend: Backend;
  automations: Automation[];
  pushOnDone: boolean;
  subagentModel: SubagentModel;
  doneModel: string;
  doneEffort: Effort | "";
  copilotModel: string;
  reviewAllModel: string;
  backupModel: string;
  gooseProviderId: string;
  gooseModelId: string;
  gooseBaseUrl: string;
}

// What a client sends, and what the route reads: the settings that changed, each of its own type.
// Only the fields that are present are sent, so a patch of one setting leaves the rest alone.
//
// The route's body is parsed JSON, so nothing here is trusted: each field is checked by its own
// validator before it is saved (app/api/settings/route.ts). The types say what a field holds when
// it is right; the validators say what happens when it isn't.
export type SettingsPatch = { [K in keyof SettingsFields]?: SettingsFields[K] };

export interface SettingsView {
  threadPrompt: string;
  defaultThreadPrompt: string;
  // Minutes a thread's CLI stays open with no messages before it closes; 0 keeps it open.
  keepAliveMinutes: number;
  // The most threads running a turn at once; the next waits for a free slot. 0 means no limit.
  maxThreads: number;
  // The mode the new-thread dialog, the API and the copilot's create_card start a card in.
  defaultPermissionMode: PermissionMode;
  // What new threads start on; puku-cli is the escape hatch when Claude hits a plan limit.
  defaultBackend: Backend;
  automations: Automation[];
  // /weft:done runs `git push` after a clean commit (plugin/skills/done/push.sh).
  pushOnDone: boolean;
  // What board threads' subagents run on; "choose" lets each thread pick (lib/subagents.ts).
  subagentModel: SubagentModel;
  // The model and effort /weft:done runs on; "" means use the card's own (lib/automations.ts doneOverrides).
  doneModel: string;
  doneEffort: Effort | "";
  // The model the copilot starts on; "" means use the user's last-picked Claude model.
  copilotModel: string;
  // The Claude model "Review all" runs on; "" means the CLI's default.
  reviewAllModel: string;
  // The first-message-failed banner reruns the card on this model; "" means the banner
  // shows "Pick a backup model" instead and opens Settings → Models on click.
  backupModel: string;
  // The Goose provider a Goose thread runs on; "" means none picked yet (lib/goose-provider.ts).
  // Only the provider's id: the key itself stays in Electron main's Keychain.
  gooseProviderId: string;
  // The model id a new Goose thread runs on; "" means the provider's own default.
  gooseModelId: string;
  // The endpoint for the providers that need one (custom, azure, litellm); "" means none.
  gooseBaseUrl: string;
  // The models the user gave a name to, so a model menu shows a name instead of a raw id
  // (lib/goose-models.ts). The board's model picker reads them from here rather than importing
  // lib/goose-models.ts, which reads the settings file off disk and so can't run in the browser.
  gooseNamedModels: { id: string; name: string }[];
  projects: { path: string; lastUsedAt: number }[];
  // Project folders whose cards sync to the cloud (lib/cloud-sync.ts). Off by default; mirrors the
  // saved settings, the same shape /api/settings sends.
  issueFolders: string[];
  syncFolders: string[];
  // Folders outside a project every thread may use without asking (lib/folder-guard.ts), granted with
  // "Always" on a folder-guard prompt. Settings → Security's trusted-folders row shows and revokes these.
  allowedFolders: string[];
}

export type LoginState = "running" | "terminal" | "done" | "failed" | "cancelled";

// A CLI login in progress (or just finished), shown to the user in a pop-up.
export interface LoginView {
  backend: Backend;
  state: LoginState;
  // The CLI's output so far, ANSI codes stripped, last few KB only.
  output: string;
  // The last https URL the CLI printed, if any (the login page).
  url?: string;
  startedAt: number;
  // Why Weft's Puku trial didn't cover this login (lib/puku-trial.ts), for the pop-up to say.
  trial?: LoginTrial;
}

// signed-out: no Weft account to give a trial token to; unavailable: the trial server said no;
// failed: a thread on a fresh trial token still couldn't sign in.
export interface LoginTrial {
  reason: "signed-out" | "unavailable" | "failed";
  message: string;
}

export interface CliStatus {
  loggedIn: boolean;
  email?: string;
  error?: string;
}

// Your Weft account (lib/account.ts): optional, for cloud features.
export type AccountProvider = "github" | "google";

export interface AccountUser {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
  // "github", "google" or "email".
  provider: string | null;
}

export interface AccountView {
  // False until the app has a Supabase key; Settings then says sign-in isn't set up yet.
  configured: boolean;
  user: AccountUser | null;
}
