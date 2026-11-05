import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { storedAgent, type ThreadAgent } from "./agents";
import { listAgents, projectAgent } from "./agent-store";
import { agentTools } from "./agent-tools";
import { firstMessage } from "./automations";
import { LIST_LIMIT } from "./board-tools-format";
import { attempt, copilotCardTools, readThreadTool, tagsPatch, type BoardActions } from "./board-tools-copilot";
import { createWorkerCard, hostListText, workerFolder } from "./board-tools-hosts";
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
import { createCard, getCard, listCards } from "./store";
import { workerReach, type WorkerReach } from "./worker-board-reach";
import { onWorkerBoard } from "./worker-board-tools";
import { onWorker } from "./worker-pane";
import type { Backend, Card, PermissionMode } from "./types";

export type { BoardActions };

// Re-exports for callers that import these from ./board-tools: lib/weft-mcp.ts builds the MCP
// servers, lib/runner-ask.ts labels the permission prompt, lib/weft-prompts.ts the copilot prompt.
export { COPILOT_PROMPT, SAFE_BOARD_TOOLS, isTrustedTool } from "./board-tools-trust";
export { describeBoardTool } from "./board-tools-format";
export { COPILOT_PHONE_ONLY } from "./board-tools-copilot";

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
  // Who the thread is (lib/agents.ts); Builder when left out.
  agent?: ThreadAgent;
}

// The one place a card is made on behalf of a thread, whether it is the copilot's or a board thread's.
export function createBoardCard(args: NewBoardCard): Card {
  const cwd = resolveFolder(args.folder);
  // The agent named, else the project's default (Settings → Agents).
  const agent = storedAgent(args.agent ?? projectAgent(cwd), listAgents());
  const card = createCard({
    title: cleanTitle(args.title ?? "") || titleFromPrompt(args.prompt),
    prompt: args.prompt,
    cwd,
    backend: args.cli ?? "claude",
    permissionMode: args.permissionMode,
    parentId: args.parentId,
    ...tagsPatch(args.tags),
    ...(agent ? { agent } : {}),
  });
  touchProject(card.cwd);
  return card;
}

const TAGS = z.array(z.string()).optional().describe("Short labels for the card, like bug or launch");
// Who the thread is, from the agents there are as the server is made (Settings → Agents adds more; lib/agent-store.ts).
const agentParam = () =>
  z.string().optional().describe(`Who the thread is, by id (default builder): ${listAgents().map((a) => `${a.id} (${a.name}${a.tagline ? `: ${a.tagline}` : ""})`).join("; ")}`);

function listCardsTool(reach: WorkerReach) {
  return tool(
    "list_cards",
    "List the threads on the board, one line each: id | column | title (★ when starred) | folder | tags | stage | remaining | waiting on | latest. Open cards only unless include_done is true (then done and archived ones too); newest first, up to limit (default 40).",
    {
      column: COLUMN.optional(),
      include_done: z.boolean().optional().describe("Also list done and archived cards (default false)"),
      limit: z.number().int().positive().optional().describe(`Most cards to list (default ${LIST_LIMIT})`),
    },
    // This Mac's cards and the user's Weft Workers' (lib/board-tools-hosts.ts).
    (opts) => attempt(() => hostListText(opts, reach)),
  );
}

type BoardTools = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>;

// What every board thread gets: look at the board and hand work off, nothing that touches other cards.
// The card is read when the tool runs, since a spare CLI only gets its card later.
export function weftMcpServer(
  getCardId: () => string | undefined,
  actions: Pick<BoardActions, "start">,
  // The thread's folder, for its project's changelog before the card is known (a warm spare).
  getCwd: () => string = () => "",
  reach: WorkerReach = workerReach(),
) {
  const tools: BoardTools = [
      listCardsTool(reach),
      tool(
        "create_card",
        "Hand work to a new thread on the board, started right away unless start is false. Its prompt must be self-contained: the thread knows nothing else. Call list_cards first so you don't duplicate a card that already exists.",
        {
          prompt: z.string(),
          title: z.string().optional(),
          folder: z.string().optional().describe("Project folder, or a worker:// project on one of the user's Weft Workers; defaults to this thread's own folder"),
          start: z.boolean().optional().describe("Run it now (default true); false leaves it in Backlog"),
          tags: TAGS,
          agent: agentParam(),
        },
        ({ prompt, title, folder, start, tags, agent }) =>
          attempt(async () => {
            // A worker project's card starts on that worker, in default mode (lib/board-tools-hosts.ts).
            const there = folder ? await workerFolder(folder, reach) : null;
            if (there) return createWorkerCard({ folder: there, prompt, title, tags, start, agent }, reach);
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
              agent,
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
      ...agentTools(getCardId),
    ];
  return createSdkMcpServer({
    name: "board",
    version: "0.1.0",
    alwaysLoad: true,
    // On a Weft Worker the tools that write the board reach the user's, not the worker's own store.
    tools: onWorker() ? onWorkerBoard(tools, { getCardId, start: actions.start, create: createBoardCard, defaultMode: defaultPermissionMode }) : tools,
  });
}

// A fresh server per query: an MCP server instance serves one connection. The tools on one card reach it on whichever
// host holds it (lib/board-tools-copilot.ts).
export function boardMcpServer(actions: BoardActions, reach: WorkerReach = workerReach()) {
  return createSdkMcpServer({
    name: "board",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      listCardsTool(reach),
      readThreadTool(reach),
      tool(
        "create_card",
        "Add a new thread to Backlog. Its prompt must be self-contained: the thread knows nothing else. It doesn't run until started.",
        {
          prompt: z.string(),
          folder: z.string().describe("Project folder, absolute or ~/..., or a worker:// project on one of the user's Weft Workers"),
          title: z.string().optional(),
          cli: z.enum(["claude", "puku", "codex", "goose"]).optional(),
          permission_mode: z.enum(["default", "acceptEdits", "auto", "bypassPermissions"]).optional(),
          tags: TAGS,
          agent: agentParam(),
        },
        (args) =>
          attempt(async () => {
            // On a worker it lands in that worker's Backlog, in default mode whatever permission_mode asks.
            const there = await workerFolder(args.folder, reach);
            if (there) return createWorkerCard({ ...args, folder: there, start: false }, reach);
            const card = createBoardCard({ ...args, permissionMode: args.permission_mode ?? defaultPermissionMode() });
            return `Created ${card.id} in Backlog: ${card.title}`;
          }),
      ),
      ...copilotCardTools(actions, reach),
      tool(
        "setup_status",
        "What isn't linked yet for the user's projects (Weft account, GitHub CLI, Vercel, Supabase, Cloudflare, analytics): what each unlocks and where the user links it. Read-only. Defaults to the projects of open cards.",
        { folder: z.string().optional().describe("One project folder, absolute or ~/..., instead of the open cards' projects") },
        ({ folder }) => attempt(() => setupReport(folder ? [resolveFolder(folder)] : activeProjects(listCards()))),
      ),
      // The copilot has no thread to fork: its crons are fresh ones in a folder, or forks of a card it names.
      ...cronTools(() => undefined),
      // The copilot writes agents too, the same way any other thread does.
      ...agentTools(() => undefined),
    ],
  });
}
