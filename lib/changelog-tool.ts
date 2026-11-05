import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addEntry, editEntry, entriesFor, KINDS, readChangelog, removeEntry, statusOf, type ChangelogEntry } from "./changelog";
import { resolveCommit } from "./changelog-git";
import { projectRoot } from "./quality-files";
import { getCard } from "./store";

// mcp__board__changelog_add / _list / _edit, in every thread's board tools (lib/board-tools.ts): a thread records what
// it shipped in its project's changelog (lib/changelog.ts) instead of editing CHANGELOG.md, which every card used to
// edit at once. The entry names the calling card; its commit stamps the sha later, a release writes the file.

type Reply = { content: { type: "text"; text: string }[]; isError?: boolean };

const reply = (text: string, isError = false): Promise<Reply> =>
  Promise.resolve({ content: [{ type: "text" as const, text }], ...(isError ? { isError } : {}) });

function attempt(run: () => string): Promise<Reply> {
  try {
    return reply(run());
  } catch (err) {
    return reply(err instanceof Error ? err.message : String(err), true);
  }
}

export const lineFor = (e: ChangelogEntry) =>
  `${e.id} | ${e.kind} | ${statusOf(e)}${e.sha ? ` ${e.sha.slice(0, 7)}` : ""}${e.version ? ` ${e.version}` : ""} | ${e.cardTitle ?? "—"} | ${e.text}`;

// A page of the list. A project's unreleased changelog runs to hundreds of entries (158, ~80k chars, on 2026-11-04), past
// what a tool answer may hold: the CLI saved it to a file the thread couldn't open. So a page holds at most PAGE entries,
// each clipped to CLIP chars (changelog_edit's answer shows one in full), and says how to get the next.
export const PAGE = 40;
const MAX_PAGE = 100;
const CLIP = 300;

const clipped = (line: string) => (line.length > CLIP ? `${line.slice(0, CLIP - 1)}…` : line);

export function pageOf(entries: ChangelogEntry[], offset = 0, limit = PAGE): string {
  if (!entries.length) return "No entries yet.";
  const from = Math.max(0, Math.floor(offset));
  const size = Math.min(MAX_PAGE, Math.max(1, Math.floor(limit)));
  const page = entries.slice(from, from + size);
  const lines = page.map((e) => clipped(lineFor(e)));
  const shown = from + page.length;
  if (from === 0 && shown === entries.length) return lines.join("\n");
  const more = shown < entries.length ? `; pass offset: ${shown} for the next page, or mine: true for this card's own` : "";
  return [...lines, `(${from + 1}–${shown} of ${entries.length}${more})`].join("\n");
}

const FILES ="Repo-relative paths of the files this change is in (e.g. lib/app-preview.ts); only a commit touching one of them stamps the entry, so another card's commit in the shared tree doesn't";

// A sha a thread names, as the full sha of a commit in the entry's project; a wrong one is an error, not a stamp.
function shaFor(id: string, sha: string): string {
  const entry = readChangelog().find((e) => e.id === id);
  if (!entry) throw new Error(`No changelog entry ${id}.`);
  const full = resolveCommit(entry.project, sha.trim());
  if (!full) throw new Error(`${sha} isn't a commit in ${entry.project}.`);
  return full;
}

export function changelogTools(getCardId: () => string | undefined, getCwd: () => string) {
  const card = () => {
    const id = getCardId();
    return id ? getCard(id) : undefined;
  };
  const project = (folder?: string) => {
    const dir = folder || card()?.cwd || getCwd();
    if (!dir) throw new Error("No project folder for this thread; pass folder.");
    return projectRoot(dir);
  };
  return [
    tool(
      "changelog_add",
      "Record a user-visible change you shipped in this project's changelog, instead of editing CHANGELOG.md (Weft writes and commits that file right after your commit). One entry per feature or fix, in the project's changelog voice: a bold one-line summary, then what changed for the user and the main files. The entry links to this card and is stamped with your commit's sha when it lands.",
      {
        kind: z.enum(KINDS).describe("Keep a Changelog section: added, changed, fixed, removed or security"),
        text: z.string().describe("The entry, Markdown, one paragraph"),
        files: z.array(z.string()).optional().describe(FILES),
        folder: z.string().optional().describe("Project folder; defaults to this thread's own folder"),
      },
      ({ kind, text, files, folder }) =>
        attempt(() => {
          const c = card();
          const entry = addEntry({ project: project(folder), kind, text, files, cardId: c?.id, cardTitle: c?.title });
          return `Added ${entry.id} to ${entry.project}'s changelog (${kind}, draft until your commit lands).`;
        }),
    ),
    tool(
      "changelog_list",
      `List this project's changelog entries not yet released (or every entry with all=true): id | kind | draft/committed/released | card | text, ${PAGE} to a page, long texts clipped. Check it before adding, so you edit your own entry instead of adding a second: mine=true lists only this card's.`,
      {
        all: z.boolean().optional().describe("Include released entries"),
        mine: z.boolean().optional().describe("Only this card's own entries"),
        offset: z.number().int().min(0).optional().describe("Entries to skip, for the next page"),
        limit: z.number().int().min(1).max(MAX_PAGE).optional().describe(`Entries per page (default ${PAGE})`),
        folder: z.string().optional().describe("Project folder; defaults to this thread's own folder"),
      },
      ({ all, mine, offset, limit, folder }) =>
        attempt(() => {
          const own = card()?.id;
          const entries = entriesFor(project(folder)).filter((e) => (all || !e.version) && (!mine || (own !== undefined && e.cardId === own)));
          return pageOf(entries, offset, limit);
        }),
    ),
    tool(
      "changelog_edit",
      "Reword, recategorise, re-file, re-stamp or remove an unreleased changelog entry by id (from changelog_list). Released entries are history. Pass sha to stamp it with the commit that really carries it (a draft its commit missed, or a stamp that landed on another card's commit).",
      {
        id: z.string(),
        text: z.string().optional(),
        kind: z.enum(KINDS).optional(),
        files: z.array(z.string()).optional().describe(FILES),
        sha: z.string().optional().describe("The commit that carries this change, full or short; replaces any earlier stamp"),
        remove: z.boolean().optional().describe("Delete the entry instead"),
      },
      ({ id, text, kind, files, sha, remove }) =>
        attempt(() => {
          if (remove) {
            removeEntry(id);
            return `Removed ${id}.`;
          }
          return `Updated: ${lineFor(editEntry(id, { text, kind, files, ...(sha ? { sha: shaFor(id, sha) } : {}) }))}`;
        }),
    ),
  ];
}
