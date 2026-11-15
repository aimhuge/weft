import { tool } from "@anthropic-ai/claude-agent-sdk";
import { armRestart } from "./restart-when-idle";
import { onWorker } from "./worker-pane";

// mcp__board__restart_weft_when_idle (lib/restart-when-idle.ts), in every thread's board tools (lib/board-tools.ts): for a
// change only a restart picks up, without cutting off running turns. Not a safe tool: it holds every card's new work
// until the restart, so the user approves it (describeBoardTool says what for). On a Weft Worker the same drain ends in
// an update to the newest main instead of a relaunch (scripts/weft-worker.ts hands that in), since a worker's code only
// changes that way.
//
// `getCardId` names the card whose thread asked, so the board can mark that card as the one waiting on the restart.
export function restartTool(getCardId: () => string | undefined = () => undefined) {
  return tool(
    "restart_weft_when_idle",
    "Restart Weft once every running turn on the board, yours included, has ended. Nothing new starts meanwhile; messages sent meanwhile go out after the restart. Use it instead of restarting Weft yourself (say after changing its Electron side), and tell the user why. On a Weft Worker it updates the worker to the newest main and restarts it into that, the way to bring a worker up to date (never run weft-worker update yourself).",
    {},
    () => {
      try {
        const n = armRestart("relaunch", getCardId()).waiting.length;
        const turns = n === 1 ? "the 1 running turn ends" : `the ${n} running turns end`;
        const what = onWorker() ? "This worker updates to the newest main and restarts" : "Weft restarts";
        return Promise.resolve({ content: [{ type: "text" as const, text: `${what} once ${turns} (yours included). Finish your reply; this thread doesn't carry on by itself after the restart.` }] });
      } catch (err) {
        return Promise.resolve({ content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }], isError: true });
      }
    },
  );
}
