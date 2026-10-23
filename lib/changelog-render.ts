import { KINDS, type ChangeKind, type ChangelogEntry } from "./changelog";

// A project's CHANGELOG.md (Keep a Changelog) as Weft writes it in the background (lib/changelog-write.ts): Unreleased
// holds the committed entries, after any lines someone typed there by hand, and a version bump moves them under
// `## [version] - date`. Weft's own bullets are told apart from typed ones by their text (every text an entry ever
// had), so rewriting the section never duplicates or drops a line.

const TITLES: Record<ChangeKind, string> = { added: "Added", changed: "Changed", fixed: "Fixed", removed: "Removed", security: "Security" };

export const HEADER = `# Changelog

What changed in each release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Weft writes this file as cards ship; a version bump moves Unreleased under the new version.

## [Unreleased]
`;

type Lines = Record<ChangeKind, string[]>;

const kindOf = (heading: string): ChangeKind | null => {
  const key = heading.trim().toLowerCase();
  return KINDS.find((kind) => kind === key) ?? (key === "deprecated" ? "changed" : null);
};

// An entry's text as one bullet line; also the key that recognises it in the file.
export const bulletOf = (text: string) => `- ${text.replace(/\s*\n\s*/g, " ").trim()}`;

// The Unreleased section's bullets by kind (a bullet's continuation lines stay with it), leaving out the ones Weft
// wrote (`known`), and where the section sits.
export function unreleasedLines(text: string, known: ReadonlySet<string> = new Set()) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^## \[Unreleased\]/i.test(line));
  const out: Lines = { added: [], changed: [], fixed: [], removed: [], security: [] };
  if (start < 0) return { out, start: -1, end: -1, lines };
  const rel = lines.slice(start + 1).findIndex((line) => line.startsWith("## ") || /^\[[^\]]+\]: /.test(line));
  const end = rel < 0 ? lines.length : start + 1 + rel;
  let kind: ChangeKind = "changed";
  for (const line of lines.slice(start + 1, end)) {
    const heading = /^###\s+(.*)$/.exec(line);
    if (heading) kind = kindOf(heading[1] ?? "") ?? "changed";
    else if (/^\s*[-*] /.test(line)) out[kind].push(line.replace(/^\s*[-*] /, "- "));
    else if (line.trim() && out[kind].length) out[kind].push(`${out[kind].pop() ?? ""}\n${line}`);
  }
  for (const k of KINDS) out[k] = out[k].filter((b) => !known.has(bulletOf(b.slice(2))));
  return { out, start, end, lines };
}

// The `### Kind` groups for these entries after the typed lines; empty when there's nothing.
function groups(entries: ChangelogEntry[], typed?: Lines) {
  return KINDS.flatMap((kind) => {
    const lines = [...(typed?.[kind] ?? []), ...entries.filter((e) => e.kind === kind).map((e) => bulletOf(e.text))];
    return lines.length ? [`### ${TITLES[kind]}\n\n${lines.join("\n")}`] : [];
  });
}

export function renderSection(version: string, date: string, entries: ChangelogEntry[], typed?: Lines) {
  const body = groups(entries, typed);
  return [`## [${version}] - ${date}`, ...(body.length ? body : ["No changes recorded."])].join("\n\n");
}

export interface RenderOptions {
  // Every text Weft's entries for this project ever had (lib/changelog.ts textsFor), as bullets.
  known?: ReadonlySet<string>;
  // Move Unreleased under this version.
  release?: { version: string; date: string };
}

// The file with `entries` (the unreleased, committed ones) written into it. A file that doesn't exist, or has no
// Unreleased heading, gets Weft's header first.
export function renderFile(text: string | null, entries: ChangelogEntry[], { known, release }: RenderOptions = {}) {
  const base = text && /^## \[Unreleased\]/im.test(text) ? text : `${HEADER}${text ? `\n${text.replace(/^# .*\n+/, "")}` : ""}`;
  const { out, start, end, lines } = unreleasedLines(base, known);
  const body = release ? [renderSection(release.version, release.date, entries, out)] : groups(entries, out);
  const before = lines.slice(0, start + 1).join("\n");
  const after = lines.slice(end).join("\n").replace(/^\n+/, "");
  return [before, ...body, after].filter(Boolean).join("\n\n").replace(/\n*$/, "\n");
}

// The release a hand-run `pnpm changelog:release` writes (lib/changelog-release.ts).
export const releaseFile = (text: string | null, version: string, date: string, entries: ChangelogEntry[], known?: ReadonlySet<string>) =>
  renderFile(text, entries, { known, release: { version, date } });
