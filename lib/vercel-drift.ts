import { shownFolders } from "./db-picker";
import { toPull, toPush, type VercelEnvironment, type VercelEnvRow, type VercelEnvStatus } from "./vercel-view";

// The vault ⇄ Vercel drift (docs/architecture/vercel.md "Drift"): which names a linked project's Vercel env has that
// the 🔐 vault holds no value for, and which vault values Vercel lacks, per environment. Names only, from the rows
// electron/vercel-env.cjs lines up (a cached list per folder, fetched in the background when a project is on the
// board). It's folded into what's already there: the 🔐 and ▲ rail badges, the ▲ drawer's 🔐 line, the 🔐 drawer's
// ▲ line, and the copilot's "Not set up yet" (lib/copilot-setup.ts).

export type VercelDrift = VercelEnvStatus & { folder: string };

export interface DriftSummary {
  // On Vercel, with no value in the vault (any environment), and the ones Pull can bring down (not sensitive).
  notInVault: string[];
  pullable: string[];
  // Vault values Vercel doesn't have, by environment.
  missing: Partial<Record<VercelEnvironment, string[]>>;
}

const names = (rows: VercelEnvRow[]) => [...new Set(rows.map((r) => r.name))];

export function driftOf(rows: VercelEnvRow[]): DriftSummary {
  const missing: DriftSummary["missing"] = {};
  for (const r of toPush(rows)) (missing[r.environment] ??= []).push(r.name);
  return { notInVault: names(rows.filter((r) => !r.inVault && r.onVercel)), pullable: names(toPull(rows)), missing };
}

export function driftCount(s: DriftSummary) {
  return s.notInVault.length + Object.values(s.missing).reduce((n, list) => n + list.length, 0);
}

// "4 on Vercel not in vault: pull?", "2 missing on preview: push?". ask leaves the question off (hover titles).
export function driftParts(s: DriftSummary, ask = true): string[] {
  const q = (what: string) => (ask ? `: ${what}?` : "");
  const parts: string[] = [];
  if (s.notInVault.length) parts.push(`${s.notInVault.length} on Vercel not in vault${s.pullable.length ? q("pull") : ""}`);
  for (const [environment, list] of Object.entries(s.missing)) parts.push(`${list.length} missing on ${environment}${q("push")}`);
  return parts;
}

// The line for a set of rows: the drift when there is one, else null so the caller keeps its own summary.
export function driftLine(rows: VercelEnvRow[]) {
  const parts = driftParts(driftOf(rows));
  return parts.length ? parts.join(" · ") : null;
}

// The board's project only (or every folder), like the drawers.
export const shownDrift = (drifts: VercelDrift[], project: string | null) => shownFolders(drifts, project);

// The rail badges' count and hover text over the shown folders.
export function driftBadge(drifts: VercelDrift[]) {
  const counted = drifts.map((d) => ({ d, s: driftOf(d.rows) })).filter(({ s }) => driftCount(s) > 0);
  return {
    count: counted.reduce((n, { s }) => n + driftCount(s), 0),
    title: counted.map(({ d, s }) => `▲ ${d.project}: ${driftParts(s, false).join(", ")}`).join(" · "),
  };
}

// The copilot's setup gaps: what drifted, by name, and the fix to suggest.
export function driftGaps(drifts: VercelDrift[]) {
  return drifts.flatMap((d) => {
    const s = driftOf(d.rows);
    if (!driftCount(s)) return [];
    const some = (list: string[]) => `${list.slice(0, 4).join(", ")}${list.length > 4 ? ", …" : ""}`;
    const what = [
      s.notInVault.length ? `${s.notInVault.length} Vercel env vars not in the 🔐 vault (${some(s.notInVault)})` : "",
      ...Object.entries(s.missing).map(([environment, list]) => `${list.length} vault secrets missing on Vercel ${environment} (${some(list)})`),
    ].filter(Boolean);
    return [{ folder: d.folder, what: `vault ⇄ Vercel env sync (${what.join("; ")})`, why: `${d.project} on Vercel and the ${d.label} vault holding the same names`, where: "the ▲ Vercel drawer's 🔐 line: Pull brings plain ones into the vault, Push sends the missing ones (Touch ID), or mcp__secrets__push_to_vercel" }];
  });
}

// What the Push button sends: every vault value Vercel lacks, by name and environment.
export const missingPairs = (rows: VercelEnvRow[]) => toPush(rows).map(({ name, environment }) => ({ name, environment }));

// What the rail asks the drift again on: the vault's names and which hold a value.
export const vaultKey = (vaults: { secrets: { name: string; environment: string; missing?: boolean }[] }[]) =>
  vaults.flatMap((v) => v.secrets.map((x) => `${x.environment}:${x.name}:${x.missing ? 0 : 1}`)).join("\n");
