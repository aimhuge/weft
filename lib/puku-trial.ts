import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { accountClient, SUPABASE_KEY } from "./account";
import { subscribe } from "./bus";
import { globalSingleton } from "./global-singleton";
import { readTrialToken } from "./puku-trial-token";
import { DATA_DIR } from "./store";

// The Puku trial on the desktop side (docs/architecture/puku-trial.md). A puku thread with no Puku login of its
// own, while you're signed in to your Weft account, runs on Weft's own Puku key through the proxy on the deployed
// Weft: Weft trades your Weft sign-in for a day-long trial token, keeps it in a 0600 file, and starts puku-cli
// with an apiKeyHelper that reads that file, so a warm CLI that lives for hours picks up each refreshed token.

// WEFT_PUKU_TRIAL_URL points the trial at another deployment (a preview, or your own fork's).
export const TRIAL_URL = process.env.WEFT_PUKU_TRIAL_URL || "https://weft-topaz.vercel.app/api/puku";
export const TOKEN_FILE = path.join(DATA_DIR, "puku-trial-token");
// Where puku-cli keeps its own login, and its user settings (an apiKeyHelper there is a login of its own too).
export const PUKU_SESSION = path.join(os.homedir(), ".config", "pukucode", "session.json");
export const PUKU_SETTINGS = path.join(os.homedir(), ".puku-cli", "settings.json");
// A token is refreshed this long before it expires, and puku-cli re-reads the file this often.
export const REFRESH_BEFORE_MS = 2 * 60 * 60 * 1000;
export const HELPER_TTL_MS = 5 * 60 * 1000;
// A thread that needs a login again this soon after Weft got a token isn't helped by another one.
export const RETRY_WINDOW_MS = 2 * 60 * 1000;

export type TrialResult = { ok: true } | { ok: false; reason: "signed-out" | "unavailable"; message: string };

const state = globalSingleton("__weftPukuTrial", () => ({
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  inflight: undefined as Promise<TrialResult> | undefined,
  fetchedAt: 0,
  unsubscribe: undefined as (() => void) | undefined,
}));

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Whether puku-cli would sign in on its own: its login file, a key in the env, or an apiKeyHelper of yours.
export function hasOwnPukuLogin(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PUKU_AI_API_KEY || env.PUKU_CLI_OAUTH_TOKEN) return true;
  const session = readJson(PUKU_SESSION);
  if (typeof session?.accessToken === "string" && session.accessToken) return true;
  const settings = readJson(PUKU_SETTINGS);
  return typeof settings?.apiKeyHelper === "string" && settings.apiKeyHelper !== "";
}

// The trial token on disk, if it's good for at least another minute.
export function currentTrialToken(now = Date.now()): string | null {
  let token: string;
  try {
    token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return null;
  }
  const claims = readTrialToken(token);
  return claims && claims.exp > now + 60_000 ? token : null;
}

// What a puku thread starts with to use the trial, or null when it signs in on its own or has no token.
export function trialOptions(now = Date.now(), platform = process.platform): { env: Record<string, string>; settings: { apiKeyHelper: string } } | null {
  if (hasOwnPukuLogin() || !currentTrialToken(now)) return null;
  const apiKeyHelper = platform === "win32"
    ? windowsTrialHelper(TOKEN_FILE)
    : `/bin/cat '${TOKEN_FILE.replace(/'/g, "'\\''")}'`;
  return {
    env: { PUKU_AI_BASE_URL: TRIAL_URL, PUKU_CLI_API_KEY_HELPER_TTL_MS: String(HELPER_TTL_MS) },
    settings: { apiKeyHelper },
  };
}

function windowsTrialHelper(file: string) {
  const literal = file.replace(/'/g, "''");
  // Encode the script so cmd.exe cannot expand characters in the Windows path.
  const script = `[Console]::Write([IO.File]::ReadAllText('${literal}').Trim())`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

// True when Weft got a token moments ago, so a thread failing again needs Puku's own login instead.
export function trialJustFetched(now = Date.now()) {
  return state.fetchedAt > 0 && now - state.fetchedAt < RETRY_WINDOW_MS;
}

function schedule(expiresAt: number, now = Date.now()) {
  clearTimeout(state.timer);
  const wait = Math.max(0, expiresAt - REFRESH_BEFORE_MS - now);
  state.timer = setTimeout(() => void fetchTrialToken(), wait);
  state.timer.unref();
}

async function accessToken(): Promise<string | null> {
  if (!SUPABASE_KEY) return null;
  const { data } = await accountClient().auth.getSession();
  return data.session?.access_token ?? null;
}

async function request(): Promise<TrialResult> {
  const token = await accessToken();
  if (!token) return { ok: false, reason: "signed-out", message: "Sign in to your Weft account to try Puku free." };
  let res: Response;
  try {
    res = await fetch(`${TRIAL_URL}/trial-token`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  } catch (err) {
    return { ok: false, reason: "unavailable", message: `Couldn't reach Weft's Puku trial: ${(err as Error).message}` };
  }
  const body = (await res.json().catch(() => ({}))) as { token?: unknown; expiresAt?: unknown; error?: unknown };
  if (res.status === 401) return { ok: false, reason: "signed-out", message: typeof body.error === "string" ? body.error : "Sign in to your Weft account again." };
  if (!res.ok || typeof body.token !== "string" || typeof body.expiresAt !== "number") {
    return { ok: false, reason: "unavailable", message: typeof body.error === "string" ? body.error : `Weft's Puku trial answered ${res.status}.` };
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, body.token, { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE, 0o600);
  state.fetchedAt = Date.now();
  schedule(body.expiresAt);
  return { ok: true };
}

// Gets a fresh trial token for the signed-in Weft account and keeps it fresh. Calls at once share one request.
export function fetchTrialToken(): Promise<TrialResult> {
  state.inflight ??= request()
    .catch((err: unknown): TrialResult => ({ ok: false, reason: "unavailable", message: (err as Error).message }))
    .finally(() => {
      state.inflight = undefined;
    });
  return state.inflight;
}

// Signing out of Weft ends the trial on this machine: the token goes, and so does its refresh.
export function forgetTrialToken() {
  clearTimeout(state.timer);
  state.timer = undefined;
  state.fetchedAt = 0;
  fs.rmSync(TOKEN_FILE, { force: true });
}

async function accountChanged(onSignIn: () => void) {
  if (await accessToken()) onSignIn();
  else forgetTrialToken();
}

// Once per server start (lib/copilot.ts prewarm): keep a token from an earlier run fresh, and follow your Weft
// sign-in: signing in calls onSignIn (the runner retries puku threads waiting on a login), signing out forgets it.
export function startPukuTrial(onSignIn: () => void, now = Date.now()) {
  if (state.unsubscribe) return;
  state.unsubscribe = subscribe((event) => {
    if (event.type === "account") void accountChanged(onSignIn).catch(() => {});
  });
  let token = "";
  try {
    token = fs.readFileSync(TOKEN_FILE, "utf8");
  } catch {}
  const claims = readTrialToken(token);
  if (claims) schedule(claims.exp, now);
}
