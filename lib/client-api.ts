// The fetch client: a single `api` object with one method per server route, plus
// the XHR upload and audio transcribe helpers.

import type { TagInfo, TagRow } from "./tags";
import type { Webhook, WebhookInput, WebhookPatch } from "./webhooks";
import type { SubagentModel } from "./subagents";
import type { CloudSyncStatus } from "./cloud-sync-view";
import type { CardShareState, CardShareUpdate } from "./share-types";
import type { GithubStatus } from "./github-view";
import type { MediaKind } from "./media";
import type { BillingClientView } from "./client-bridge";
import type { CopilotPersona } from "./copilot-personas";
import type {
  AccountProvider,
  AccountView,
  Automation,
  Backend,
  Card,
  CliStatus,
  Column,
  DevLauncher,
  DevServerStatus,
  Effort,
  GithubRepo,
  LocalRepo,
  LoginView,
  MachineInfo,
  PermissionMode,
  Project,
  QuestionReply,
  RestartStatus,
  ServiceEntry,
  SettingsView,
  SkillInfo,
  SkillSetView,
  ThreadItem,
} from "./types";

export interface NewCardInput {
  // Left out, the server names the card from its prompt.
  title?: string;
  prompt: string;
  cwd: string;
  backend: Backend;
  // Left out, the server uses the default permission mode from settings.
  permissionMode?: PermissionMode;
  model?: string;
  effort?: Effort;
  // Tags to start with (lib/tags.ts); they count as yours.
  tags?: string[];
  start: boolean;
}

export interface UploadedAttachment {
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  bytes: number;
}

// How long an upload waits for the server's reply once its bytes are sent.
export const UPLOAD_REPLY_MS = 60_000;

// Uploads a pasted or dropped file as-is. XHR rather than fetch, for upload progress (0 to 1).
function upload(file: Blob, name: string, onProgress?: (fraction: number) => void) {
  return new Promise<UploadedAttachment>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/attachments");
    xhr.setRequestHeader("x-weft-token", "1");
    xhr.setRequestHeader("x-filename", encodeURIComponent(name));
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    // The bytes are all sent; a server too busy to answer in a minute shouldn't leave it spinning forever.
    let waiting: ReturnType<typeof setTimeout> | undefined;
    xhr.upload.onload = () => {
      waiting = setTimeout(() => {
        xhr.abort();
        reject(new Error("Weft's server didn't answer in a minute. Remove it and paste again."));
      }, UPLOAD_REPLY_MS);
    };
    xhr.onloadend = () => clearTimeout(waiting);
    xhr.onload = () => {
      let data: { error?: string } & Partial<UploadedAttachment> = {};
      try {
        data = JSON.parse(xhr.responseText) as typeof data;
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.path) resolve(data as UploadedAttachment);
      else reject(new Error(data.error ?? `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.send(file);
  });
}

// What a fetch that never reached the server says. The browser's own message is a bare "Failed to fetch"
// (Safari: "Load failed"), which tells the user nothing; the usual cause is Weft's server restarting.
export const UNREACHABLE = "Couldn't reach Weft's server. It may be restarting; try again in a moment.";

// fetch, with a dropped connection turned into UNREACHABLE. An abort is the caller's own doing and passes through.
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error(UNREACHABLE, { cause: err });
  }
}

// The reply's JSON body. A restarting dev server answers with an HTML error page; that is a failed call
// (the status says so), not a SyntaxError from the parser.
async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    if (res.ok) throw new Error("Weft's server sent a reply that isn't JSON.");
    return {} as T & { error?: string };
  }
}

async function transcribe(audio: Blob) {
  const res = await send("/api/transcribe", {
    method: "POST",
    headers: { "x-weft-token": "1", "content-type": audio.type || "audio/webm" },
    body: audio,
  });
  const data = await readJson<{ text?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? (res.statusText || `Request failed (${res.status}).`));
  return data.text ?? "";
}

export async function call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await send(url, {
    method,
    headers: { "content-type": "application/json", "x-weft-token": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const data = await readJson<T>(res);
  if (!res.ok) throw new Error(data.error ?? (res.statusText || `Request failed (${res.status}).`));
  return data;
}

export const api = {
  list: () => call<{ cards: Card[]; home: string; roots: Record<string, string> }>("GET", "/api/cards"),
  create: (input: NewCardInput) => call<{ card: Card }>("POST", "/api/cards", input),
  move: (id: string, column: Column) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { column }),
  reorder: (id: string, before: string | null) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { before }),
  rename: (id: string, title: string) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { title }),
  setMode: (id: string, permissionMode: PermissionMode) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { permissionMode }),
  archive: (id: string, archived: boolean) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { archived }),
  // ★ and tags. Tags are normalized on the server, become yours (tagsBy "user"), and new ones join the catalog.
  mark: (id: string, patch: { starred?: boolean; tags?: string[] }) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, patch),
  // The Share… dialog: the card's share link, or why it can't have one yet (lib/card-share.ts).
  getShare: (id: string) => call<CardShareState>("GET", `/api/cards/${id}/share`),
  setShare: (id: string, update: CardShareUpdate) => call<CardShareState>("PUT", `/api/cards/${id}/share`, update),
  // The tag catalog (lib/tag-store.ts): every tag with its colour, description and card count, by name.
  tags: () => call<{ tags: TagRow[] }>("GET", "/api/tags"),
  createTag: (name: string, color?: string, description?: string) => call<{ tag: TagInfo }>("POST", "/api/tags", { name, color, description }),
  // rename gives it a new name on every card (merging into a tag that already has it).
  updateTag: (name: string, patch: { rename?: string; color?: string; description?: string }) =>
    call<{ tag: TagInfo }>("PATCH", "/api/tags", { name, ...patch }),
  deleteTag: (name: string) => call<{ ok: true }>("DELETE", "/api/tags", { name }),
  setStarred: (id: string, starred: boolean) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { starred }),
  setTags: (id: string, tags: string[]) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { tags }),
  // The user granted read access to a path outside the project. Persists on the card and queues
  // a /add-dir slash command for the live session so the in-flight turn can keep reading.
  // "Always allow" on an outside-folder prompt: every card may use it (lib/folder-guard.ts).
  allowFolder: (folder: string) => call("POST", "/api/folders", { folder }),
  // Settings → Security's trusted-folders row: take a folder back out, so threads ask about it again.
  unallowFolder: (folder: string) => call<{ ok: true }>("DELETE", "/api/folders", { folder }),
  setReadScope: (id: string, path: string) => call<{ card: Card }>("PATCH", `/api/cards/${id}`, { readScope: path }),
  remove: (id: string) => call("DELETE", `/api/cards/${id}`),
  send: (id: string, text: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { text }),
  // A stopped or failed card's Restart: its last message again, in a fresh CLI.
  restart: (id: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { restart: true }),
  // Replaces your last message and the turn it started, stopping that turn if it's running.
  editLast: (id: string, text: string) => call<{ card: Card }>("POST", `/api/cards/${id}/messages`, { text, edit: true }),
  // Sends text to the thread at `at` (unix ms), even if Weft was closed then (it goes on the next start).
  schedule: (id: string, text: string, at: number) => call<{ card: Card }>("POST", `/api/cards/${id}/scheduled`, { text, at }),
  unschedule: (id: string, messageId: string) => call("DELETE", `/api/cards/${id}/scheduled`, { messageId }),
  // pendingId is the request the user saw; the server refuses the answer if another is in front.
  // reply: a question's notes, or "Chat about this" instead of answers.
  answer: (id: string, allow: boolean, answers?: Record<string, string>, pendingId?: string, reply?: QuestionReply) =>
    call("POST", `/api/cards/${id}/permission`, { allow, answers, pendingId, ...reply }),
  // Wait on a symbol-claim prompt: Weft answers it once the card holding that code lets go.
  waitPermission: (id: string, pendingId: string) => call("POST", `/api/cards/${id}/permission`, { wait: true, pendingId }),
  stop: (id: string) => call("POST", `/api/cards/${id}/stop`),
  // The task strip's Stop: ends one subagent or background command (lib/task-stop.ts).
  stopTask: (id: string, taskId: string) => call<{ ok: true }>("POST", `/api/cards/${id}/tasks/${encodeURIComponent(taskId)}/stop`),
  // "!" in the reply box: runs a shell command in the card's folder (lib/shell.ts).
  shell: (id: string, command: string) => call<{ ok: true }>("POST", `/api/cards/${id}/shell`, { command }),
  // "Send fresh" on a cold-cache card: a new session in the same card, from a brief of the thread (lib/splice.ts).
  fresh: (id: string, message: string) => call<{ ok: true }>("POST", `/api/cards/${id}/fresh`, { message }),
  // Stops the Claude CLI that has a picked-up session open in another app.
  release: (id: string) => call<{ stopped: number }>("POST", `/api/cards/${id}/release`),
  // Flips a card's CLI, or with model picks one of its models (same CLI: no new session). replay=true re-sends the last user message (the rate-limit escape hatch).
  switchBackend: (id: string, backend: Backend, replay = false, model?: string) =>
    call<{ card: Card }>("POST", `/api/cards/${id}/switch-backend`, { backend, replay, model }),
  // First-message-failed banner: rerun the card's last user message on a different model
  // (lib/backend-switch.ts rerunOnModel), starting a fresh session of the same CLI.
  rerunModel: (id: string, model: string) =>
    call<{ card: Card }>("POST", `/api/cards/${id}/rerun-model`, { model }),
  // Delete the card: ends the session and removes it from the board.
  deleteCard: (id: string) => call<{ ok: true }>("DELETE", `/api/cards/${id}`),
  // Column-level "Switch all to <other>". Busy cards come back in `pending` so the column can
  // confirm with the user before retrying.
  switchBackends: (ids: string[], backend: Backend) =>
    call<{ switched: string[]; failed: { id: string; error: string }[]; pending: string[] }>(
      "POST",
      "/api/cards/switch-backend",
      { ids, backend },
    ),
  devStatus: (id: string) => call<{ status: DevServerStatus }>("GET", `/api/cards/${id}/dev`),
  devAction: (id: string, action: "start" | "restart" | "stop") =>
    call<{ status: DevServerStatus }>("POST", `/api/cards/${id}/dev`, { action }),
  // The rail's Services drawer: every process Weft spawned (thread CLIs, dev servers, terminals), with CPU and memory.
  services: () => call<{ services: ServiceEntry[]; launchers?: DevLauncher[]; machine?: MachineInfo }>("GET", "/api/services"),
  launchDev: (cwd: string, command: string) => call<{ ok: true; result: "started" | "restarted"; id: string }>("POST", "/api/services", { action: "launch", cwd, command }),
  serviceAction: (body: { action: "kill"; id?: string; pid?: number } | { action: "restart"; id: string }) =>
    call<{ ok: true }>("POST", "/api/services", body),
  copilot: () => call<{ card: Card }>("GET", "/api/copilot"),
  resetCopilot: () => call<{ card: Card }>("POST", "/api/copilot/reset"),
  // Switching persona starts a new chat (lib/copilot.ts setCopilotPersona).
  copilotPersona: (persona: CopilotPersona) => call<{ card: Card }>("POST", "/api/copilot/persona", { persona }),
  copilotSuggestions: () => call<{ chips: { text: string; cardId?: string; project?: string; covers?: string[] }[]; covers: string[] }>("GET", "/api/copilot/suggestions"),
  copilotChipClicked: (text: string) => call<{ ok: true }>("POST", "/api/copilot/suggestions", { text }),
  // Restart when idle (lib/restart-when-idle.ts): nothing new starts, and Weft restarts once the running turns end.
  restartStatus: () => call<RestartStatus>("GET", "/api/restart"),
  restartWhenIdle: () => call<RestartStatus>("POST", "/api/restart", {}),
  cancelRestart: () => call<RestartStatus>("DELETE", "/api/restart"),
  settings: () => call<SettingsView>("GET", "/api/settings"),
  saveSettings: (patch: {
    threadPrompt?: string;
    keepAliveMinutes?: number;
    defaultPermissionMode?: PermissionMode;
    defaultBackend?: Backend;
    automations?: Automation[];
    pushOnDone?: boolean;
    subagentModel?: SubagentModel;
    doneModel?: string;
    doneEffort?: Effort | "";
    copilotModel?: string;
    reviewAllModel?: string;
    backupModel?: string;
  }) =>
    call<SettingsView>("PATCH", "/api/settings", patch),
  addProject: (path: string) => call<{ path: string; projects: Project[] }>("POST", "/api/projects", { path }),
  newProject: (parent: string, name: string) =>
    call<{ path: string; projects: Project[] }>("POST", "/api/projects/new", { parent, name }),
  removeProject: (path: string) => call<{ projects: Project[] }>("DELETE", "/api/projects", { path }),
  loginStatus: () => call<{ status: Record<Backend, CliStatus>; runs: LoginView[] }>("GET", "/api/login"),
  login: (backend: Backend, action: "start" | "input" | "cancel" | "terminal", text?: string, signal?: AbortSignal) =>
    call<{ login: LoginView | null }>("POST", "/api/login", { backend, action, text }, signal),
  // Starts a CLI ahead of time: a card's own, or a spare in a project folder.
  warm: (body: { cardId?: string; cwd?: string; backend?: Backend }) => call<{ ok: true }>("POST", "/api/warm", body),
  // The splash page the browser pane shows beside the New thread dialog.
  newThreadPage: () => call<{ url: string }>("POST", "/api/new-thread-page", {}),
  // Prompts the user wrote, in cards on the board. Matched words in each snippet sit between \u0001 and \u0002.
  searchPrompts: (q: string) =>
    call<{ hits: { cardId: string; at: number; snippet: string }[]; indexing: boolean }>("GET", `/api/search?q=${encodeURIComponent(q)}`),
  thread: (id: string) => call<{ items: ThreadItem[] }>("GET", `/api/cards/${id}/thread`),
  // Weft's skills and yours; with cwd, that folder's too.
  skills: (cwd?: string) =>
    call<{ skills: SkillInfo[] }>("GET", `/api/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
  // A project's skill set, or a card's, and turning one skill or plugin on or off there (lib/skill-sets.ts).
  skillSet: (where: { cwd: string } | { card: string }) =>
    call<SkillSetView>("GET", `/api/skills/set?${"card" in where ? `card=${encodeURIComponent(where.card)}` : `cwd=${encodeURIComponent(where.cwd)}`}`),
  setSkill: (where: { cwd: string } | { card: string }, name: string, on: boolean) => call<SkillSetView>("PUT", "/api/skills/set", { ...where, name, on }),
  uploadAttachment: upload,
  dictation: () => call<{ available: boolean; reason?: string; model?: string }>("GET", "/api/transcribe"),
  transcribe,
  repos: (fresh = false) => call<{ repos: LocalRepo[] }>("GET", `/api/repos${fresh ? "?fresh=1" : ""}`),
  githubRepos: (fresh = false) => call<{ repos: GithubRepo[] }>("GET", `/api/repos/github${fresh ? "?fresh=1" : ""}`),
  // Your Weft account (lib/account.ts). signIn returns the provider's page to open in the system browser.
  account: () => call<AccountView>("GET", "/api/account"),
  signIn: (provider: AccountProvider, next?: string) =>
    call<{ url: string }>("POST", "/api/account", { action: "oauth", provider, ...(next ? { next } : {}) }),
  magicLink: (email: string) => call<{ ok: true }>("POST", "/api/account", { action: "email", email }),
  signOut: () => call<{ ok: true }>("POST", "/api/account", { action: "signout" }),
  // The signed-in user's billing status (lib/billing-client.ts); null when signed out, { error } on a failure.
  billingStatus: () => call<BillingClientView>("GET", "/api/account/billing"),
  cloneRepo: (fullName: string) => call<{ path: string; projects: Project[] }>("POST", "/api/repos/clone", { fullName }),
  // A folder's open GitHub issues as Backlog cards, now and every 5 minutes after (lib/github-issues.ts).
  importIssues: (folder: string) =>
    call<{ folder: string; added: number; updated: number; archived: number }>("POST", "/api/github/issues", { folder }),
  stopIssues: (folder: string) => call<{ folders: string[] }>("DELETE", "/api/github/issues", { folder }),
  // A webhook on the folder's repo, relayed by Weft's Supabase, so its issues sync within seconds (lib/github-hooks.ts).
  addHook: (folder: string) => call<{ repo: string }>("POST", "/api/github/hooks", { folder }),
  removeHook: (folder: string) => call<{ ok: true }>("DELETE", "/api/github/hooks", { folder }),
  // Live pull from Vercel: a team webhook relayed by Weft's Supabase pulls new env variables into the vault (lib/vercel-hooks.ts).
  vercelHooks: () => call<{ signedIn: boolean; teams: string[] }>("GET", "/api/vercel/hooks"),
  addVercelHook: (folder: string) => call<{ team: string }>("POST", "/api/vercel/hooks", { folder }),
  removeVercelHook: (folder: string) => call<{ ok: true }>("DELETE", "/api/vercel/hooks", { folder }),
  // The GitHub drawer: who gh is signed in as, and each folder's repo and issue sync (lib/github-status.ts).
  github: (folders: string[]) => call<GithubStatus>("GET", `/api/github?${new URLSearchParams(folders.map((f) => ["folder", f]))}`),
  // The Settings → Sync page (lib/use-cloud-sync.ts): opt-in folders and the live flush status.
  cloudSync: () => call<{ folders: string[]; status: CloudSyncStatus }>("GET", "/api/cloud-sync"),
  cloudSyncSetFolder: (folder: string, on: boolean) => call<{ folder: string; on: boolean; folders: string[]; status: CloudSyncStatus }>("POST", "/api/cloud-sync", { folder, on }),
  cloudSyncNow: () => call<{ status: CloudSyncStatus }>("POST", "/api/cloud-sync", { sync: true }),
  // The 🪝 drawer: each folder's webhooks, and a public relay URL for one (lib/webhooks.ts; signedIn: the relay needs a Weft account).
  webhooks: (folders: string[]) => call<{ hooks: Webhook[]; signedIn: boolean }>("GET", `/api/webhooks?${new URLSearchParams(folders.map((f) => ["folder", f]))}`),
  addWebhook: (input: WebhookInput) => call<{ hook: Webhook; existed: boolean }>("POST", "/api/webhooks", input),
  updateWebhook: (id: string, patch: WebhookPatch) => call<{ hook: Webhook }>("PATCH", `/api/webhooks/${id}`, patch),
  removeWebhook: (id: string) => call<{ ok: true }>("DELETE", `/api/webhooks/${id}`),
  relayWebhook: (id: string) => call<{ hook: Webhook }>("POST", `/api/webhooks/${id}/relay`),
  unrelayWebhook: (id: string) => call<{ hook: Webhook }>("DELETE", `/api/webhooks/${id}/relay`),
};
