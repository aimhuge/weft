// Type shim for ./server-patch-deps.mjs so the test file gets real types instead of `any`.
// The runtime module is unchanged; only TS uses these declarations.

// The fingerprint of a standalone server's node_modules: every file's path and size,
// sorted and hashed. `files` counts them.
export interface DepsFingerprint {
  hash: string;
  files: number;
}

// The name of the fingerprint file, written beside the server.
export const DEPS_FILE: string;

// Every file under a node_modules folder as "path size" (a link as "path -> target").
export function listFiles(dir: string, rel?: string): string[];

// { hash, files } for a standalone folder's node_modules.
export function depsFingerprint(standalone: string): DepsFingerprint;

// Writes the fingerprint beside the server and returns it.
export function writeDepsFile(standalone: string): DepsFingerprint;
