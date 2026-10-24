import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, text } from "./browser-tools";
import { devStatus, reachable, startDev, stopDev } from "./devserver";
import { findDev, listDev } from "./devserver-list";
import { getCard } from "./store";

// The dev servers in the Services drawer, for threads (docs/architecture/dev-servers.md). Threads start the project's
// dev server through Weft, not Bash run_in_background: the server keeps running after this thread's
// CLI closes, the user sees it on the rail and can stop it there, and the thread panel's task strip
// stays clean.
export const DEVSERVERS_PROMPT = `Start the project's dev server with mcp__devservers__start, not Bash run_in_background. Weft keeps it running after this thread's CLI closes, lists it in the Services drawer, and the user can stop it there. mcp__devservers__status shows every server Weft knows about; mcp__devservers__stop ends the one this thread started.`;

const COMMAND = z.string().min(1).describe("The dev command to run from the project folder, e.g. \"npm run dev\" or \"pnpm dev\"");
const URL = z.url().optional().describe("The url the dev server answers on once it's up, e.g. http://localhost:3000; the tool polls it for up to 60s");
const CWD = z.string().optional().describe("Absolute path of the project the server runs in; defaults to this thread's folder");

// Waits up to 60s for the url to answer, polling every second.
async function waitReachable(url: string): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (await reachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function describeLine(e: { cardId: string; title?: string; cwd: string; command: string; url?: string; state: string; source: string }): string {
  const tag = e.source === "weft" ? "weft" : "thread";
  const head = e.title ? `${tag} "${e.title}" (${e.cardId})` : `${tag} (${e.cardId})`;
  return `- ${head} ${e.command} [${e.state}]${e.url ? ` ${e.url}` : ""}`;
}

function insideProject(folder: string, target: string): boolean {
  const rel = path.relative(folder, target);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** mcp__devservers__*. cwd and cardId are read when a tool runs. */
export function devserversMcpServer(cardId: () => string | undefined, cwd: () => string) {
  const project = (p?: string) => {
    const dir = p ?? cwd();
    if (!insideProject(cwd(), dir)) throw new Error(`cwd must be inside the project folder (${cwd()})`);
    return dir;
  };
  return createSdkMcpServer({
    name: "devservers",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool(
        "start",
        "Start the project's dev server through Weft, not Bash run_in_background: Weft keeps it running after this thread's CLI closes, lists it in the Services drawer, and the user can stop it there. Reuses a live run with the same cwd and command; otherwise starts a new one and polls url (when given) for up to 60s.",
        { command: COMMAND, url: URL, cwd: CWD },
        async ({ command, url, cwd: c }) =>
          attempt(async () => {
            const dir = project(c);
            const id = cardId();
            if (!id) return text("No card is bound to this thread.", true);
            const existing = findDev(dir, command);
            const targetCard = existing?.cardId ?? id;
            const started: { url?: string; port?: number } = (existing ? undefined : await startDev(id, command, dir, getCard(id)?.title, url)) ?? {};
            const at = started.url ?? url;
            const up = at ? await waitReachable(at) : false;
            const status = await devStatus(targetCard, at);
            const own = started.port ? `\nPort: ${started.port} (this isolated card's own, as PORT; pass --port ${started.port} to tools that ignore PORT)` : "";
            return text(
              `${existing ? "Reused" : "Started"} ${command} in ${dir}.${own}\nState: ${status.state}${at ? `\nURL: ${at} (${up ? "reachable" : "not reachable yet"})` : ""}\nLog:\n${status.log || "(empty)"}`,
            );
          }),
      ),
      tool("status", "List every dev server Weft knows about: the one this thread started, any Weft started for the review tour, and background dev servers threads started the old way.", {}, async () =>
        attempt(async () => {
          const servers = await listDev();
          if (!servers.length) return text("No dev servers running.");
          return text(`Dev servers (newest first):\n${servers.map(describeLine).join("\n")}`);
        }),
      ),
      tool("stop", "Stop the dev server this thread started. No-op when nothing is running.", {}, () =>
        attempt(() => {
          const id = cardId();
          if (!id) return Promise.resolve(text("No card is bound to this thread.", true));
          stopDev(id);
          return Promise.resolve(text("Stopped."));
        }),
      ),
    ],
  });
}
