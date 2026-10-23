// Settings, permissions, logins and account types.

import type { Automation, Backend, PermissionMode } from "./types-card";
import type { SubagentModel } from "./subagents";

export type { Backend, PermissionMode, Automation };
export { BACKEND_LABELS, MODES, MODE_OPTIONS, permissionOptions, toPermissionMode } from "./types-card";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface SettingsView {
  threadPrompt: string;
  defaultThreadPrompt: string;
  // Minutes a thread's CLI stays open with no messages before it closes; 0 keeps it open.
  keepAliveMinutes: number;
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
