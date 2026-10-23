import type { ChangelogEntry } from "./changelog";

// How the Changelog dialog (components/ChangelogDialog.tsx) lays out a project's entries: Unreleased first, then each
// version newest first, entries newest first within each; and the line under an entry saying where it stands.

export interface ChangelogGroup {
  // null for Unreleased.
  version: string | null;
  releasedAt?: number;
  entries: ChangelogEntry[];
}

export function groupEntries(entries: ChangelogEntry[]): ChangelogGroup[] {
  const sorted = [...entries].sort((a, b) => b.at - a.at);
  const unreleased = sorted.filter((e) => !e.version);
  const versions = new Map<string, ChangelogGroup>();
  for (const e of sorted) {
    if (!e.version) continue;
    const group = versions.get(e.version) ?? { version: e.version, releasedAt: e.releasedAt, entries: [] };
    group.entries.push(e);
    versions.set(e.version, group);
  }
  const released = [...versions.values()].sort((a, b) => (b.releasedAt ?? 0) - (a.releasedAt ?? 0));
  return [...(unreleased.length ? [{ version: null, entries: unreleased }] : []), ...released];
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// "draft", "committed abc1234", "abc1234 · 1.2.0".
export function stateLine(e: ChangelogEntry): string {
  if (e.version) return e.sha ? `${e.sha.slice(0, 7)} · ${e.version}` : e.version;
  return e.sha ? `committed ${e.sha.slice(0, 7)}` : "draft";
}

export const groupTitle = (g: ChangelogGroup) => (g.version ? `${g.version}${g.releasedAt ? ` · ${day(g.releasedAt)}` : ""}` : "Unreleased");
