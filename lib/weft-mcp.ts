import { boardMcpServer, weftMcpServer } from "./board-tools";
import { boardViewMcpServer } from "./board-view-tools";
import { browserMcpServer } from "./browser-tools";
import { devserversMcpServer } from "./devserver-tools";
import { hooks, type Spec } from "./runner-state";
import { secretsMcpServer } from "./secret-tools";
import { getCard } from "./store";
import { webhooksMcpServer } from "./webhook-tools";

// Weft's own MCP servers for a thread: the browser pane, the board, and for threads (not the copilot) the vault,
// webhooks and the board window. Claude Code and puku-cli take them in-process; Codex reaches the same ones
// over HTTP (lib/mcp-bridge.ts). Each call builds fresh servers, since an MCP server instance serves one connection.
// The card is read when a tool runs, since a spare CLI only gets its card later.
export function weftMcpServers(spec: Spec, cardId: () => string | undefined) {
  return {
    browser: browserMcpServer(cardId),
    // Threads only: the copilot runs the board, not a project.
    ...(spec.copilot ? {} : { secrets: secretsMcpServer(cardId, () => spec.cwd, () => getCard(cardId() ?? "")?.title), webhooks: webhooksMcpServer(() => spec.project ?? spec.cwd), devservers: devserversMcpServer(cardId, () => spec.cwd), board_view: boardViewMcpServer() }),
    board: spec.copilot ? boardMcpServer(hooks.boardActions) : weftMcpServer(cardId, hooks.boardActions, () => spec.project ?? spec.cwd),
  };
}
