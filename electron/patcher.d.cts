// Type shim for ./patcher.cjs so the test file gets real types instead of `any`.
// The runtime module is unchanged; only TS uses these declarations.

import type { PatchDetails, SignedFeed } from "./server-patch-feed.cjs";

// The patcher's state, which the board's UI reads and the app's menu mirrors.
export interface PatcherState {
  phase: "idle" | "checking" | "downloading" | "ready" | "applying";
  build?: string;
  notes?: string;
  reason?: string;
  skipped?: string;
  error?: string;
  applied?: string;
  checkedAt?: number;
}

// What the app tells the patcher about itself and what it can do.
export interface PatcherOptions {
  currentVersion: string;
  packaged: boolean;
  // The public half of the signing key; null in a build without one (no patches taken).
  publicKey: string | null;
  feed?: string;
  // url → the feed, or null when no patch is published.
  fetchJson: (url: string) => Promise<SignedFeed | null>;
  // url → the patch's bytes.
  download: (url: string) => Promise<Buffer>;
  // (details, bytes) → the patch it staged.
  stage: (details: PatchDetails, bytes: Buffer) => { build: string; seq: number };
  // () → this app's own state: its package fingerprint, the patch it runs, its bad builds.
  readLocal: () => { deps: string | null; activeSeq: number; bad: string[] };
  countRunning?: () => Promise<number | null>;
  idleSeconds?: () => number;
  // Restarts the server into the staged patch.
  applyNow?: () => Promise<void>;
  restartWhenIdle?: () => Promise<void>;
  // Asks the user what to do; "idle" waits for the threads, "now" switches at once.
  ask?: (what: string, why: string) => Promise<string | null>;
  notify?: (title: string, body: string, options?: { apply?: () => Promise<boolean> }) => void;
  // A full update is on its way.
  busy?: () => boolean;
  onChange?: (state: PatcherState) => void;
  log?: Console;
}

export interface Patcher {
  check(): Promise<PatcherState>;
  apply(): Promise<boolean>;
  applyWhenQuiet(): Promise<boolean>;
  start(): void;
  stop(): void;
  state(): PatcherState;
}

export function createPatcher(options: PatcherOptions): Patcher;

export const PATCH_FEED: string;
export const CHECK_EVERY_MS: number;
export const FIRST_CHECK_MS: number;
export const AWAY_SECONDS: number;
export const QUIET_CHECK_MS: number;
