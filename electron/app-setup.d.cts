// Type shim for ./app-setup.cjs so the test file (and any future TS importer) gets real types
// instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import type { Vault } from "./app-data.cjs";

// The pane's ownership check (electron/browser-pane.cjs's `pane.owns`). True when the
// webContents is one of the pane's main views, which every app-data handler demands.
export type OwnsPane = (wc: { id?: string } | null | undefined) => boolean;

// The board window check (electron/main.cjs's isBoard). True when the sender is the board
// window; the Share dialog's "Upload secrets" answers only it.
export type IsBoard = (sender: { id?: string } | null | undefined) => boolean;

// Supabase per-project link lookup (electron/supabase.cjs). The linked project ref, or null
// when the folder has no Supabase project linked.
export type ReadLink = (folder: string) => Promise<{ ref: string } | null>;

// Electron's safeStorage (electron/account-store.cjs). Only availability is consulted here;
// the store itself reads encryptString / decryptString off the same object when it's
// available. Tests pass a fake that only knows about availability.
export interface SafeStorage {
  isEncryptionAvailable: () => boolean;
  encryptString?: (plain: string) => Buffer | string;
  decryptString?: (sealed: Buffer | string) => string;
}

// A deferred ref to safeStorage: Electron exposes it after `app.whenReady`, so setupApps takes
// a getter that resolves it on first use rather than the module at wire time.
export type GetSafeStorage = () => SafeStorage;

// The handle setupApps hands back to main.cjs: a getter for the sealed Supabase session, keyed
// by the "weft-auth" key (lib/account.ts). Reading it builds the store on the first call, so
// safeStorage being unavailable at wire time is fine.
export type AccountGetter = () => Record<string, string>;

// The local server's address and launch token (electron/main.cjs's `server`). The live-data
// bridge reads it fresh on each call, because the server may not be up when setupApps runs.
export type ServerAccessor = () => { url: string; token: string } | null;

export interface AppsHandle {
  account: AccountGetter;
}

export function setupApps(opts: {
  // Each required field is guarded at runtime with a plain-English error; the test passes
  // `undefined` deliberately to confirm that guard fires. The d.cts allows `undefined` for
  // the same reason: the runtime check is the contract, the type just has to not lie about
  // callers.
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void } | undefined;
  vault: Vault | undefined;
  ownsPane: OwnsPane | undefined;
  isBoard: IsBoard | undefined;
  dataDir: string | undefined;
  supabaseReadLink: ReadLink | undefined;
  getSafeStorage: GetSafeStorage | undefined;
  server: ServerAccessor | undefined;
}): AppsHandle;