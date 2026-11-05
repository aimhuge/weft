// The 🔐 drawer's Import all and Locate… (docs/architecture/secrets.md#found-elsewhere): the words they toast, and
// Import all itself, which takes the import preview's ticked rows with no preview. Values never pass through here:
// main reads the files again when it imports.

import { defaultPicks, picksOf, type ImportScan, type VaultBridge } from "./vault-view";

// "Imported 18 secrets from ../weft-build/.env.local." Names the files the picks came from, at most two.
export function importedText(scan: ImportScan, picks: { file: string; name: string }[]) {
  if (!picks.length) return "Nothing new to import: the vault already holds these values.";
  const files = [...new Set(picks.map((p) => p.file))];
  const from = files.length > 2 ? `${files.slice(0, 2).join(", ")} and ${files.length - 2} more` : files.join(" and ");
  const names = new Set(picks.map((p) => p.name)).size;
  const left = scan.rows.filter((r) => r.status === "differs").length;
  const differ = left ? ` ${left} that differ from the vault are left for Import… to review.` : "";
  return `Imported ${names} secret${names === 1 ? "" : "s"} from ${from}.${differ}`;
}

export async function importAllFrom(bridge: VaultBridge, folder: string) {
  const scan = await bridge.scan(folder);
  const picks = picksOf(scan, defaultPicks(scan));
  if (picks.length) await bridge.import(folder, picks);
  return importedText(scan, picks);
}

export const locateEmptyText = (file: string) => `${file} has no NAME=value lines, so Weft didn't keep it.`;
