// Type shim for ./live-data.cjs so the test file (and any future TS importer) gets real types
// instead of `any`. The runtime module is unchanged; only TS uses these declarations.

import type { OwnsPane, ServerAccessor } from "./app-setup.d.cts";

export type { OwnsPane, ServerAccessor };

/**
 * The answer to a live read. `ok: true` carries the parsed JSON body; `ok: false` carries a
 * sentence the page can show in place of the number it couldn't read.
 */
export interface LiveResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  status?: number;
}

/** A liveData function: takes a path on Weft's own server, answers a LiveResult. */
export type LiveData = (path: string) => Promise<LiveResult>;

/** The local server's address and launch token, read fresh on each call (it may not be up yet). */
export type { ServerAccessor };

export function createLiveData(opts: {
  serverUrl: string | (() => string);
  token: string | (() => string);
  fetch?: typeof fetch;
}): LiveData;

export function registerLiveData(
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void },
  opts: { liveData: LiveData; owns: OwnsPane },
): void;

export function setupLiveData(opts: {
  ipcMain: { handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void };
  serverUrl: string | (() => string);
  token: string | (() => string);
  owns: OwnsPane;
  fetch?: typeof fetch;
}): LiveData;

/** Throws when the path isn't one this bridge is allowed to read. */
export function cleanPath(raw: unknown): string;

/** The paths a page may ask for. */
export const ALLOWED: string[];
