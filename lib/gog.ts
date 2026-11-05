import { spawn } from "node:child_process";
import { runCliText, whichBin } from "./cli-exec";
import { cliEnv } from "./env";
import { globalSingleton } from "./global-singleton";
import type { GogAccount, GogStatus } from "./gog-view";

// gog, the Google Workspace CLI (github.com/steipete/gogcli): Settings → Connectors' first connector
// (docs/architecture/connectors.md). Weft.app ships it in its toolchain (scripts/bundle-toolchain.mjs, same version),
// at the end of PATH, so a gog the user installed themselves still wins.
export const GOG_VERSION = "0.47.0";
const RUN_MS = 15_000;
// How long a browser sign-in may take before Weft gives up on it.
export const ADD_TIMEOUT_MS = 5 * 60_000;

// Every thread's system prompt (lib/weft-prompts.ts): how to reach Google Workspace, and that mail and invites need an OK.
export const GOG_PROMPT = `When the work touches the user's Google Workspace (Gmail, Calendar, Drive, Docs, Sheets, Contacts, Tasks), use the gog CLI from Bash: \`gog auth tokens list --json\` names the connected accounts (token:<client>:<email>; it reads no secrets, unlike \`gog auth list\`), then pass \`-a <email> --client <client> --json\` to each command. If none is connected, tell the user to sign one in at Settings → Connectors. Sending mail, creating or changing events and sharing files reach other people: draft or preview with \`--dry-run\`, and confirm before you send.`;

type AddRun = { email: string; child: ReturnType<typeof spawn>; cancelled: boolean };
// Kept on globalThis so a dev-mode reload doesn't lose a sign-in in progress.
const state = globalSingleton("__weftGog", () => ({ adding: null as AddRun | null, lastError: null as string | null }));

export function gogPath(): string | null {
  return whichBin("gog", { env: cliEnv() });
}

function run(bin: string, args: string[], input?: string): Promise<string> {
  return runCliText(bin, args, { env: cliEnv(), timeout: RUN_MS, input });
}

// "v0.47.0 (f7dab31f …)" or "0.12.0 (Homebrew …)" → "0.47.0".
export function parseVersion(text: string): string {
  return /v?(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? text.trim();
}

export function olderThan(version: string, than: string): boolean {
  const a = version.split(".").map(Number);
  const b = than.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

// `gog auth tokens list --json` names each stored refresh token "token:<client>:<email>". It lists the keyring's keys
// without opening them: `auth list` decrypts every token, and when the gog asking isn't the one that stored them
// (Homebrew's gog vs the one Weft ships) macOS asks for the login password on every read.
export function parseAccounts(json: string): GogAccount[] {
  const parsed = JSON.parse(json) as { keys?: unknown[] };
  return (parsed.keys ?? []).flatMap((key) => {
    const match = typeof key === "string" ? /^token:([^:]+):(.+)$/.exec(key) : null;
    // Both groups are there whenever the pattern matches.
    return match?.[1] && match[2] ? [{ client: match[1], email: match[2] }] : [];
  });
}

// Weft's own Google OAuth client (Desktop app), stored in gog under this name. Its id and secret come from the 🔐 vault
// in dev and are baked into a release build (next.config.ts); an installed app's client secret isn't confidential
// to Google, but it stays out of git. Unset, users bring their own client.
export const WEFT_CLIENT = "weft";
export function weftClientJson(): string | null {
  const id = process.env.WEFT_GOOGLE_CLIENT_ID;
  const secret = process.env.WEFT_GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  return JSON.stringify({
    installed: {
      client_id: id,
      client_secret: secret,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      redirect_uris: ["http://localhost"],
    },
  });
}

// The OAuth client names gog has stored. Reads gog's config only: `auth status` also opens the keyring.
async function storedClients(bin: string): Promise<string[]> {
  const parsed = JSON.parse(await run(bin, ["auth", "credentials", "list", "--json"])) as { clients?: { client?: unknown }[] };
  return (parsed.clients ?? []).flatMap((c) => (typeof c.client === "string" ? [c.client] : []));
}

const ownClient = (clients: string[]) => clients.find((c) => c !== WEFT_CLIENT) ?? null;

export async function gogStatus(): Promise<GogStatus> {
  const bin = gogPath();
  if (!bin) return { installed: false };
  const version = parseVersion(await run(bin, ["--version"]));
  const [clients, accounts] = await Promise.all([
    storedClients(bin).catch((): string[] => []),
    run(bin, ["auth", "tokens", "list", "--json"]).then(parseAccounts, () => []),
  ]);
  return {
    installed: true,
    version,
    bundled: bin.includes("/toolchain/bin/"),
    outdated: olderThan(version, GOG_VERSION),
    ownClient: ownClient(clients) !== null,
    weftClient: weftClientJson() !== null,
    accounts,
    adding: state.adding?.email ?? null,
    lastError: state.lastError,
  };
}

function requireGog(): string {
  const bin = gogPath();
  if (!bin) throw new Error("gog isn't on this app's PATH.");
  return bin;
}

// A Google Cloud OAuth client (Desktop app) as downloaded from the console: {"installed": {...}} or {"web": {...}}.
export function checkClientJson(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't JSON. Download the OAuth client from Google Cloud → Credentials.");
  }
  const client = parsed as { installed?: { client_id?: unknown }; web?: { client_id?: unknown } } | null;
  if (!client || typeof (client.installed ?? client.web)?.client_id !== "string") {
    throw new Error("That JSON isn't an OAuth client: it needs an \"installed\" (Desktop app) client_id.");
  }
}

// The client JSON goes to gog on stdin, never to a file Weft writes; gog keeps it in its own config.
export async function setGogCredentials(text: string): Promise<void> {
  checkClientJson(text);
  await run(requireGog(), ["auth", "credentials", "set", "-"], text);
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const busy = () => (state.adding ? new Error(`Already signing in ${state.adding.email}; finish that in the browser first.`) : null);

// The client a new sign-in goes through: the user's own when they chose one, else Weft's (stored in gog first).
async function signInClient(bin: string): Promise<string> {
  const own = ownClient(await storedClients(bin).catch((): string[] => []));
  if (own) return own;
  const weft = weftClientJson();
  if (!weft) throw new Error("Choose an OAuth client JSON first.");
  await run(bin, ["auth", "credentials", "set", "-", "--client", WEFT_CLIENT], weft);
  return WEFT_CLIENT;
}

// gog opens the browser for Google's consent page and listens on localhost for the redirect; this waits for it.
export async function addGogAccount(email: string, { readonly = false } = {}): Promise<void> {
  if (!EMAIL.test(email)) throw new Error("Enter the Google account's email.");
  const before = busy();
  if (before) throw before;
  const bin = requireGog();
  const client = await signInClient(bin);
  const after = busy();
  if (after) throw after;
  const args = ["auth", "add", email, "--client", client, ...(readonly ? ["--readonly"] : [])];
  const child = spawn(bin, args, { env: cliEnv(), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr.on("data", (d: Buffer) => (output += d.toString()));
  const timer = setTimeout(() => child.kill(), ADD_TIMEOUT_MS);
  const add: AddRun = { email, child, cancelled: false };
  state.adding = add;
  state.lastError = null;
  const finish = (error: string | null) => {
    clearTimeout(timer);
    if (state.adding === add) state.adding = null;
    // A sign-in the user cancelled isn't a failure.
    state.lastError = add.cancelled ? null : error;
  };
  child.on("error", (err) => finish(err.message));
  child.on("close", (code) => finish(code === 0 ? null : lastLine(output) || `gog auth add exited with ${code}`));
}

export function cancelGogAdd(): void {
  if (!state.adding) return;
  state.adding.cancelled = true;
  state.adding.child.kill();
}

const CLIENT_NAME = /^[\w.-]+$/;

export async function removeGogAccount(email: string, client = "default"): Promise<void> {
  if (!EMAIL.test(email) || !CLIENT_NAME.test(client)) throw new Error("Unknown account.");
  await run(requireGog(), ["auth", "remove", email, "--client", client, "--force", "--no-input"]);
}

function lastLine(text: string): string {
  return text.trim().split("\n").filter(Boolean).pop()?.trim() ?? "";
}
