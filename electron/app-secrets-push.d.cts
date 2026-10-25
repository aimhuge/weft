// Type shim for ./app-secrets-push.cjs so the test file (and any future TS importer) gets real
// types instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import type { Manifest } from "./app-data.cjs";
import type { ParsedPolicy } from "./app-fetch-policy.cjs";

// The board window check (electron/main.cjs's isBoard). True when the sender is the board
// window; the Share dialog's "Upload secrets" answers only the board.
export type IsBoard = (sender: { id?: string } | null | undefined) => boolean;

// The Touch ID gate used by the vault (electron/vault.cjs confirm). Resolves to true when the
// user confirmed, false when they declined.
export type Confirm = (reason: string) => Promise<boolean>;

// One stored session value: the sealed store keeps the "weft-auth" entry either as the raw
// JSON string it wrote, or already parsed when a caller handed back an object. accessTokenFrom
// accepts both and only reads `access_token` off the parsed form.
export type StoredSession = string | { access_token?: unknown };

// The sealed account store's read (electron/account-store.cjs read). Returns the saved
// session keyed by "weft-auth" (lib/account.ts); empty when the user isn't signed in.
export type Account = Record<string, StoredSession> | null | undefined;

export type AccountGetter = () => Account;

// The fetch implementation the push uses to talk to weft.zip; tests inject a fake so the test
// avoids the network and the production call goes through `globalThis.fetch`.
export type FetchLike = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

// One name + value the push will upload. The shape matches what the routes expect; values
// never cross to the page (only the names do).
export type PushedValues = Record<string, string>;

export type PushSuccess = { ok: true; pushed: string[]; missing: string[]; error?: string };
export type PushFailure = { error: string };

export type PushResult = PushSuccess | PushFailure;

export interface AppSecretsPush {
  // Pushes the manifest's author secrets and public names to weft.zip. A missing appId, an
  // app that hasn't been shared, or an empty vault every short-circuit to `{ error }`.
  push(appId: string): Promise<PushResult>;
}

export function accessTokenFrom(account: Account): string | null;

// Names the manifest declared that the push will send: every secret that's not from: "viewer",
// then the keys its named reads need (deriveNeeds), followed by public names, de-duplicated, in declaration order. Viewer secrets and undeclared
// names are not pushed.
export function namesToPush(policy: ParsedPolicy, reads?: Record<string, unknown>): string[];

// What hosts the manifest's secrets are allowed to talk to, by name. Used in the Touch ID
// sheet so the user sees where each name will go. Skips from: "viewer" names.
export function pushTargets(policy: ParsedPolicy, reads?: Record<string, unknown>): string[];

// Looks up the saved app by id from ~/.weft/apps.json. Returns the app or null when the id
// isn't there.
export function findApp(dataDir: string, id: string): { id: string; url: string; share?: { id: string } } | null;

// Reads the manifest for the page a saved app points at. Throws a plain-English error when
// the folder no longer exists, no longer lives under the apps dir, or has no weft-app.json.
export function readAppManifest(dataDir: string, app: { url: string }): { manifest: Manifest; folder: string };

// The folder whose vault the push reads: the manifest's `folder`, else the app's own folder.
export function vaultFolderOf(manifest: { folder?: unknown }, appFolder: string): string;

export function createAppSecretsPush(opts: {
  // Every field except `fetch` is checked at construction with a plain-English error, so a
  // caller can hand in `undefined` and get the guard's message rather than a runtime
  // TypeError later. The d.cts mirrors that: it types what the guard accepts.
  dataDir: string | undefined;
  vault: { valuesFor(folder: string, names: string[], env: string): Promise<{ values: PushedValues; missing: string[]; label: string }> } | undefined;
  account: AccountGetter | undefined;
  confirm: Confirm | undefined;
  // Optional in production (defaults to globalThis.fetch); tests pass a fake.
  fetch?: FetchLike;
}): AppSecretsPush;

export function registerAppSecretsPush(
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => unknown },
  opts: { push: (appId: string) => Promise<PushResult>; isBoard: IsBoard },
): void;

export function setupAppSecretsPush(opts: {
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => unknown };
  dataDir: string;
  vault: { valuesFor(folder: string, names: string[], env: string): Promise<{ values: PushedValues; missing: string[]; label: string }> };
  account: AccountGetter;
  confirm: Confirm;
  isBoard: IsBoard;
  fetch?: FetchLike;
}): { push: (appId: string) => Promise<PushResult> };

// The control server's POST /apps/push-secrets: the same push, for Weft's server to call on a new link.
export function appSecretsRoutes(get?: () => { push: (appId: string) => Promise<unknown> } | null): { "POST /apps/push-secrets": (body: { appId?: unknown }) => Promise<unknown> };
