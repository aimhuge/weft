import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { addEntry, editEntry, entriesFor, KINDS, removeEntry, statusOf, type ChangelogEntry } from "./changelog";
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
        folder: z.string().optional().describe("Project folder; defaults to this thread's own folder"),
      },
      ({ kind, text, folder }) =>
        attempt(() => {
          const c = card();
          const entry = addEntry({ project: project(folder), kind, text, cardId: c?.id, cardTitle: c?.title });
          return `Added ${entry.id} to ${entry.project}'s changelog (${kind}, draft until your commit lands).`;
        }),
    ),
    tool(
      "changelog_list",
      "List this project's changelog entries not yet released (or every entry with all=true): id | kind | draft/committed/released | card | text. Check it before adding, so you edit your own entry instead of adding a second.",
      {
        all: z.boolean().optional().describe("Include released entries"),
        folder: z.string().optional().describe("Project folder; defaults to this thread's own folder"),
      },
      ({ all, folder }) =>
        attempt(() => {
          const entries = entriesFor(project(folder)).filter((e) => all || !e.version);
          return entries.length ? entries.map(lineFor).join("\n") : "No entries yet.";
        }),
    ),
    tool(
      "changelog_edit",
      "Reword, recategorise or remove an unreleased changelog entry by id (from changelog_list). Released entries are history.",
      {
        id: z.string(),
        text: z.string().optional(),
        kind: z.enum(KINDS).optional(),
        remove: z.boolean().optional().describe("Delete the entry instead"),
      },
      ({ id, text, kind, remove }) =>
        attempt(() => {
          if (remove) {
            removeEntry(id);
            return `Removed ${id}.`;
          }
          return `Updated: ${lineFor(editEntry(id, { text, kind }))}`;
        }),
    ),
  ];
}
