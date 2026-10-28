// The .env import's shape and the rules the preview shows (docs/architecture/secrets.md). Split out
// of lib/vault-view.ts so that file stays under the line cap; lib/vault-view.ts re-exports
// everything here, so the callers import it from there as before.

import type { VaultEnvironment } from "./vault-view";

export type ImportStatus = "new" | "same" | "differs" | "missing";

export interface ImportRow {
  file: string;
  name: string;
  environment: VaultEnvironment;
  status: ImportStatus;
  tail: string;
  // NEXT_PUBLIC_*: it ends up in the browser bundle anyway.
  public: boolean;
  ticked: boolean;
  // A short-lived value from `vercel env pull`, like VERCEL_OIDC_TOKEN.
  skipped: boolean;
}

export interface ImportFile {
  file: string;
  environment: VaultEnvironment;
  namesOnly: boolean;
  // git tracks it, so its values are in history already.
  tracked: boolean;
  vercel: boolean;
}

export interface ImportScan {
  id: string;
  label: string;
  files: ImportFile[];
  rows: ImportRow[];
}

export const STATUS_LABEL: Record<ImportStatus, string> = { new: "new", same: "same", differs: "differs", missing: "missing" };

export const pickKey = (row: { file: string; name: string }) => `${row.file}\n${row.name}`;

// The preview's rows by file, in the order main listed the files.
export function importGroups(scan: ImportScan) {
  return scan.files
    .map((file) => ({ ...file, rows: scan.rows.filter((r) => r.file === file.file) }))
    .filter((g) => g.rows.length > 0);
}

export function defaultPicks(scan: ImportScan) {
  return new Set(scan.rows.filter((r) => r.ticked).map(pickKey));
}

export function picksOf(scan: ImportScan, picked: Set<string>) {
  return scan.rows.filter((r) => picked.has(pickKey(r))).map((r) => ({ file: r.file, name: r.name }));
}

export function importLabel(count: number) {
  return count ? `Import ${count}` : "Nothing picked";
}

// The tracked-file warning, or null when git tracks none of them.
export function trackedWarning(scan: ImportScan) {
  const tracked = scan.files.filter((f) => f.tracked && !f.namesOnly).map((f) => f.file);
  if (!tracked.length) return null;
  return `git tracks ${tracked.join(", ")}, so ${tracked.length === 1 ? "its" : "their"} values are in history: rotate them at the provider, not just import.`;
}
