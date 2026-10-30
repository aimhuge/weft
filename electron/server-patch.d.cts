// Type shim for ./server-patch.cjs so the test file gets real types instead of `any`.
// The runtime module is unchanged; only TS uses these declarations.

import type { PatchDetails } from "./server-patch-feed.cjs";

// The parts of Electron's app the patch code uses: where its data lives and what version
// it is. A test passes a fake with the same two methods.
export interface PatchApp {
  getPath(name: string): string;
  getVersion(): string;
}

// Where the packaged server starts from: its entry point, the skills folder beside it, and
// the patch it runs from (null for the app's own server).
export interface ServerPaths {
  serverJs: string;
  pluginDir: string;
  patch: string | null;
}

// A staged patch: which build it is, its sequence number, and where it was unpacked.
export interface StagedPatch {
  build: string;
  seq: number;
  root: string;
}

// Unpacks a downloaded patch tarball into a folder.
export type Extract = (tarPath: string, dir: string) => void;

// The app's patches folder: <userData>/patches.
export function patchesDir(app: PatchApp): string;

// The packages' fingerprint the app was built with, or null when it has none.
export function bundledDeps(resourcesPath: string): string | null;

// The builds that already failed on this Mac.
export function badBuilds(app: PatchApp): string[];

// The staged patch this app should run, or null.
export function stagedPatch(app: PatchApp): StagedPatch | null;

// Where the packaged server starts from; remembers the patch it picked.
export function serverPaths(app: PatchApp, resourcesPath?: string): ServerPaths;

// Called when the packaged server exits on its own; true when it dropped a patch.
export function patchFailed(
  app: PatchApp,
  stats: { livedMs: number; crashes: number; maxCrashes: number },
  log?: { write?: (line: string) => void },
): boolean;

// Unpacks a downloaded patch tarball and makes it the staged one.
export function stagePatch(
  app: PatchApp,
  details: Pick<PatchDetails, "build" | "seq">,
  tarPath: string,
  extract: Extract,
  resourcesPath?: string,
): StagedPatch;

// "0.6.7" for the app's own server, "0.6.7+abc123" for a patch.
export function versionLabel(app: PatchApp): string;

// The patch the server was last launched from, or null for the app's own.
export function runningPatch(): StagedPatch | null;

// A patched server that dies sooner than this is dropped.
export const TRIAL_MS: number;
