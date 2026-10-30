// Type shim for ./app-data-fetch.cjs so the test file (and any future TS importer) gets real types
// instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import type { AppFetchRequest, AppFetchResult } from "../lib/app-bridge";
import type { Manifest, SavedApp } from "./app-data.cjs";
import type { ParsedPolicy } from "./app-fetch-policy.cjs";

// The dns.lookup-style callback the fetch executor hands to: (hostname, options, callback).
// runFetch calls this with { all: true }; it accepts an array of { address, family } or null,
// and refuses the request if any resolved address is private. The .cjs default of
// `dns.promises.lookup.bind(dns.promises)` is the promise form (which never matches), so
// production must override it; tests pass a callback-form fake.
export type DnsLookup = (
  hostname: string,
  options: { all: true },
  callback: (err: unknown, addresses: { address: string; family: number }[] | null) => void,
) => void;

// What the page may pass to weft.fetch before normalisation. The .cjs cleans this into an
// AppFetchRequest: lower-cased header names, string body, default method = GET.
export type RawFetchRequest = {
  url?: unknown;
  method?: unknown;
  headers?: unknown;
  body?: unknown;
};

export type AppDataFetch = {
  fetch(event: unknown, rawRequest: RawFetchRequest): Promise<AppFetchResult>;
  env(event: unknown): Promise<Record<string, string>>;
  requestSecret(event: unknown, name: string): Promise<{ set: boolean }>;
  resolve(event: unknown): Promise<{ folder: string; manifest: Manifest; saved: SavedApp }>;
};

export type Vault = import("./app-data.cjs").Vault;

export function createAppDataFetch(opts: {
  // `dataDir` and `vault` are guarded at runtime (a missing one throws "needs dataDir"), so
  // they may arrive undefined; the guard is the contract, not the type.
  dataDir: string | undefined;
  vault: Vault | undefined;
  fetch?: (url: string, init?: unknown) => Promise<unknown>;
  // dns.lookup-style (callback form). See `DnsLookup` above.
  lookup?: DnsLookup;
  // The clock a saved grant is stamped with; Date.now by default.
  now?: () => number;
}): AppDataFetch;

export function registerAppDataFetch(
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => void },
  opts: { appDataFetch: AppDataFetch; owns: (sender: unknown) => boolean },
): void;

export function setupAppDataFetch(opts: {
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => Promise<unknown>) => void };
  dataDir: string;
  vault: Vault;
  owns: (sender: unknown) => boolean;
  fetch?: (url: string, init?: unknown) => Promise<unknown>;
}): AppDataFetch;

// Normalises a raw fetch call from the page into the strict AppFetchRequest the rest of the
// pipeline expects. Throws an Error with kind `bad-request` on any malformed input.
export function cleanRequest(raw: unknown): AppFetchRequest;

// Builds the getValues function runFetch uses: for each placeholder the request asked for,
// look up the value in the vault's granted env. A missing name is the empty map so runFetch
// surfaces a 409 (the secret layer is the one that knows it isn't set).
export function makeGetValues(opts: {
  vault: { valuesFor(folder: string, names: string[], env: string): Promise<{ values: Record<string, string>; label: string; missing: string[] }> };
  folder: string;
  env: string;
}): (asked: string[]) => Promise<Record<string, string>>;

// Re-export the policy type for callers that want it without importing app-fetch-policy.cjs
// directly (matches the runtime surface).
export type { ParsedPolicy };
