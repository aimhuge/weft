import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { firstMessage } from "./automations";
import { boardCard, cardLine, LIST_LIMIT, readThreadText } from "./board-tools-format";
import { markSeen } from "./copilot-digest";
import { setupReport } from "./copilot-setup";
import { activeProjects } from "./copilot-sources";
import { resolveFolder } from "./folders";
import { changelogTools } from "./changelog-tool";
import { cronTools } from "./cron-tools";
import { skillTools } from "./skill-tools";
import { folderAccessTool } from "./folder-access-tool";
import { restartTool } from "./restart-tool";
import { cleanTitle, titleFromPrompt } from "./format";
import { defaultPermissionMode, touchProject } from "./settings";
import { createCard, getCard, listCards, updateCard } from "./store";
import { rememberTags } from "./tag-store";
import { normalizeTags } from "./tags";
import type { Backend, Card, PermissionMode } from "./types";

// Re-exports for callers that import these from ./board-tools: lib/weft-mcp.ts builds the MCP
// servers, lib/runner-ask.ts labels the permission prompt, lib/weft-prompts.ts the copilot prompt.
export { COPILOT_PROMPT, SAFE_BOARD_TOOLS, isTrustedTool } from "./board-tools-trust";
export { describeBoardTool } from "./board-tools-format";

// What the board tools need from the runner, passed in to avoid a circular import.
export interface BoardActions {
  start(cardId: string, text: string): void;
  stop(cardId: string): Promise<void>;
  answer(cardId: string, allow: boolean, answers?: Record<string, string>): void;
  isBusy(cardId: string): boolean;
}

async function attempt(run: () => string | Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await run() }] };
  } catch (err) {
    return { content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

const COLUMN = z.enum(["backlog", "running", "needs_you", "review", "done"]);

interface NewBoardCard {
  prompt: string;
  folder: string;
  title?: string;
  cli?: Backend;
  permissionMode: PermissionMode;
  // The card whose thread asked for this one.
  parentId?: string;
  // Tags to start with; they count as the user's, and new ones join the catalog (lib/tag-store.ts).
  tags?: string[];
}

// The one place a card is made on behalf of a thread, whether it is the copilot's or a board thread's.
export function createBoardCard(args: NewBoardCard): Card {
  const card = createCard({
    title: cleanTitle(args.title ?? "") || titleFromPrompt(args.prompt),
    prompt: args.prompt,
    cwd: resolveFolder(args.folder),
    backend: args.cli ?? "claude",
    permissionMode: args.permissionMode,
    parentId: args.parentId,
    ...tagsPatch(args.tags),
  });
  touchProject(card.cwd);
  return card;
}

// Tags a thread or the copilot set count as the user's, so retitle leaves them alone.
function tagsPatch(raw: string[] = []): Pick<Card, "tags" | "tagsBy"> {
  const tags = normalizeTags(raw);
  if (!tags.length) return {};
  rememberTags(tags);
  return { tags, tagsBy: "user" };
}

const TAGS = z.array(z.string()).optional().describe("Short labels for the card, like bug or launch");

function listCardsTool() {
  return tool(
    "list_cards",
    "List the threads on the board, one line each: id | column | title (★ when starred) | folder | tags | stage | remaining | waiting on | latest. Open cards only unless include_done is true (then done and archived ones too); newest first, up to limit (default 40).",
    {
      column: COLUMN.optional(),
      include_done: z.boolean().optional().describe("Also list done and archived cards (default false)"),
      limit: z.number().int().positive().optional().describe(`Most cards to list (default ${LIST_LIMIT})`),
    },
    ({ column, include_done = false, limit = LIST_LIMIT }) =>
      attempt(() => {
        const all = listCards().filter((c) => c.role !== "copilot" && (!column || c.column === column));
        const cards = all
          .filter((c) => include_done || (c.column !== "done" && !c.archived))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        const hidden = all.length - cards.length;
        const notes = [
          cards.length > limit && `${cards.length - limit} more not shown; raise limit or pass column.`,
          hidden > 0 && `${hidden} done or archived left out; pass include_done=true to list them.`,
        ].filter(Boolean);
        if (!cards.length) notes.unshift(`No ${hidden ? "open " : ""}cards${column ? ` in ${column}` : ""}.`);
        return [...cards.slice(0, limit).map(cardLine), ...notes].join("\n");
      }),
  );
}

// What every board thread gets: look at the board and hand work off, nothing that touches other cards.
// The card is read when the tool runs, since a spare CLI only gets its card later.
export function weftMcpServer(
  getCardId: () => string | undefined,
  actions: Pick<BoardActions, "start">,
  // The thread's folder, for its project's changelog before the card is known (a warm spare).
  getCwd: () => string = () => "",
) {
  return createSdkMcpServer({
    name: "board",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      listCardsTool(),
      tool(
        "create_card",
        "Hand work to a new thread on the board, started right away unless start is false. Its prompt must be self-contained: the thread knows nothing else. Call list_cards first so you don't duplicate a card that already exists.",
        {
          prompt: z.string(),
          title: z.string().optional(),
          folder: z.string().optional().describe("Project folder; defaults to this thread's own folder"),
          start: z.boolean().optional().describe("Run it now (default true); false leaves it in Backlog"),
          tags: TAGS,
        },
        ({ prompt, title, folder, start, tags }) =>
          attempt(() => {
            const parentId = getCardId();
            const parent = parentId ? getCard(parentId) : undefined;
            const card = createBoardCard({
              prompt,
              title,
              folder: folder ?? parent?.cwd ?? "",
              // Same trust level as the thread that asked.
              permissionMode: parent?.permissionMode ?? defaultPermissionMode(),
              parentId: parent?.id,
              tags,
            });
            if (start === false) return `Created ${card.id} in Backlog: ${card.title}`;
            actions.start(card.id, firstMessage(card));
            return `Created and started ${card.id}: ${card.title}`;
          }),
      ),
      restartTool(getCardId),
      folderAccessTool(),
      ...changelogTools(getCardId, getCwd),
      ...cronTools(getCardId),
      ...skillTools(getCwd),
    ],
  });
}

// A fresh server per query: an MCP server instance serves one connection.
export function boardMcpServer(actions: BoardActions) {
  return createSdkMcpServer({
    name: "board",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      listCardsTool(),
      tool(
        "read_thread",
        "Read a thread's conversation: user messages, agent replies, tool calls, and permission requests.",
        { card_id: z.string(), last: z.number().int().positive().optional().describe("Only the last N entries (default 30)") },
        ({ card_id, last }) =>
          attempt(() => readThreadText(card_id, last)),
      ),
      tool(
        "create_card",
        "Add a new thread to Backlog. Its prompt must be self-contained: the thread knows nothing else. It doesn't run until started.",
        {
          prompt: z.string(),
          folder: z.string().describe("Project folder, absolute or ~/..."),
          title: z.string().optional(),
          cli: z.enum(["claude", "puku", "codex", "goose"]).optional(),
          permission_mode: z.enum(["default", "acceptEdits", "auto", "bypassPermissions"]).optional(),
          tags: TAGS,
        },
        (args) =>
          attempt(() => {
            const card = createBoardCard({ ...args, permissionMode: args.permission_mode ?? defaultPermissionMode() });
            return `Created ${card.id} in Backlog: ${card.title}`;
          }),
      ),
      tool(
        "set_tags",
        "Replace a card's tags (an empty list clears them). Tags are short lowercase labels, like GitHub's.",
        { card_id: z.string(), tags: z.array(z.string()) },
        ({ card_id, tags }) =>
          attempt(() => {
            const card = boardCard(card_id);
            const patch = tagsPatch(tags);
            updateCard(card.id, { tags: patch.tags ?? [], tagsBy: "user" });
            return patch.tags ? `Tagged “${card.title}”: ${patch.tags.join(", ")}.` : `Cleared “${card.title}”'s tags.`;
          }),
      ),
      tool("start_card", "Start a Backlog card running its prompt.", { card_id: z.string() }, ({ card_id }) =>
        attempt(() => {
          const card = boardCard(card_id);
          if (card.column !== "backlog") {
            throw new Error(`“${card.title}” is in ${card.column}, not Backlog. Use send_message to continue it.`);
          }
          actions.start(card.id, firstMessage(card));
          return `Started “${card.title}”.`;
        }),
      ),
      tool(
        "send_message",
        "Reply to a thread that isn't running. It continues the same session with your message.",
        { card_id: z.string(), text: z.string() },
        ({ card_id, text }) =>
          attempt(() => {
            const card = boardCard(card_id);
            actions.start(card.id, text);
            return `Sent to “${card.title}”.`;
          }),
      ),
      tool(
        "move_card",
        "Move a card to Backlog, Review, or Done. Running and Needs you follow the thread itself. Unlike the user's own moves, this doesn't run the board's automations; to run a skill on a card, send_message it /<skill> (for example /weft:done).",
        { card_id: z.string(), column: z.enum(["backlog", "review", "done"]) },
        ({ card_id, column }) =>
          attempt(() => {
            const card = boardCard(card_id);
            if (actions.isBusy(card.id)) throw new Error(`“${card.title}” is running. Stop it first.`);
            updateCard(card.id, { column });
            markSeen(card.id, column);
            return `Moved “${card.title}” to ${column}.`;
          }),
      ),
      tool("stop_card", "Stop a running thread's current turn.", { card_id: z.string() }, ({ card_id }) =>
        attempt(async () => {
          const card = boardCard(card_id);
          await actions.stop(card.id);
          return `Stopped “${card.title}”.`;
        }),
      ),
      tool(
        "setup_status",
        "What isn't linked yet for the user's projects (Weft account, GitHub CLI, Vercel, Supabase, Cloudflare, analytics): what each unlocks and where the user links it. Read-only. Defaults to the projects of open cards.",
        { folder: z.string().optional().describe("One project folder, absolute or ~/..., instead of the open cards' projects") },
        ({ folder }) => attempt(() => setupReport(folder ? [resolveFolder(folder)] : activeProjects(listCards()))),
      ),
      tool(
        "answer_permission",
        "Allow or deny the permission request a thread is waiting on, or answer the question it asked (pass answer). Only do this when the user has told you to.",
        { card_id: z.string(), allow: z.boolean(), answer: z.string().optional().describe("Your answer, when the thread asked a question") },
        ({ card_id, allow, answer }) =>
          attempt(() => {
            const card = boardCard(card_id);
            const questions = card.pending?.questions;
            const answers = questions && answer ? Object.fromEntries(questions.map((q) => [q.question, answer])) : undefined;
            actions.answer(card.id, allow, answers);
            return `${allow ? "Allowed" : "Denied"} on “${card.title}”.`;
          }),
      ),
      // The copilot has no thread to fork: its crons are fresh ones in a folder, or forks of a card it names.
      ...cronTools(() => undefined),
    ],
  });
}
