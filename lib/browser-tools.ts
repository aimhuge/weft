import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { notePage } from "./card-page";
import { recordExplore } from "./explore";
import { actTools } from "./browser-act-tools";
import { attempt, shell, text, type ToolResult } from "./browser-shell";
import { asText } from "./format";
import { SHOW_DIR } from "./show-dir";
import { onWorker, openOnWorker } from "./worker-pane";
import { siteNotesForUrl } from "./site-notes-live";
import { noteUrl } from "./site-notes-trail";

// Where they lived first; a dozen modules still import them from here.
export { attempt, shell, text, type ToolResult };

export const BROWSER_PROMPT = `You are running inside Weft, a desktop app with a browser pane beside the user's board.
Use the mcp__browser__* tools to open pages there (for example a dev server you started), read them, take screenshots, and click or type. The user can see that pane.
To act on a page, take mcp__browser__snapshot for its elements and their refs, then click, type_text, press_key, select_option or hover by ref; wait_for what should appear, and set_viewport phone to check a mobile layout. When a page misbehaves, read console_logs and network_errors before guessing.
Your replies are shown as Markdown. To show the user an image or video file (a screenshot you saved, a chart, a generated picture), put it in your reply as ![what it shows](/absolute/path/to/file.png) and it appears inline in the thread. Screenshots from your tools are shown to the user automatically.
Every turn, before you reply, make sure the pane shows something current for this turn: no exceptions for quick answers, questions, follow-ups or small fixes. If the pane is blank or shows an earlier step, open or update a page first. When there is no page for your work yet (a commit, a refactor, research, a plan, a diff, a test run), render what you're doing as one self-contained HTML file outside the project folder, in ${SHOW_DIR} (e.g. ${SHOW_DIR}/<topic>.html), where it stays after a restart: a timeline, a diagram, a before/after, stats, the plan as cards. Open it with mcp__browser__open_url and update it as the work moves. Make it worth looking at, not a copy of your reply. It's read on a phone too, so make it responsive: a viewport meta tag, a fluid layout with nothing fixed wider than 360px, tap-sized controls. Once there's a real page for the work (the app, a dev server), show that instead.
When a long task is ahead of you (several steps, minutes of building), write your plan to a page and open it in one of your first tool calls, before you dig in: the steps as cards or a checklist, the one you're on marked. Then carry the plan out in the same turn: the page is not a stopping point, so don't end your turn to show it unless the user asked only for a plan. Tick steps off as they finish, so the user can watch the plan while you build.
When what you hand back is something the user has to do themselves (set up a domain, click through a dashboard, run commands), make it its own instructions page in its own folder (e.g. ${SHOW_DIR}/<topic>/index.html): numbered steps as <input type="checkbox"> items, links, commands in <code> to copy, an inline SVG diagram where a flow helps, and a screenshot for each step you can show. To take one, open the real site in the pane (the user is logged in there) and call mcp__browser__screenshot with save_to in that folder and highlight on what to click, then show it with a relative src. The user can star the page into their library and tick the steps off over days, so keep it self-contained.`;

// BROWSER_PROMPT for a thread on a Weft Worker (lib/weft-prompts.ts): the pane is on the user's board, on another
// computer, and it shows pages this machine sends up (lib/worker-pane.ts).
export const WORKER_BROWSER_PROMPT = `You are running on a Weft Worker, a headless machine. The user follows your card on their board from another computer, on the desktop app or at weft.zip, with a browser pane beside your thread.
The pane shows pages, and mcp__browser__open_url is how they get there: give it a page's absolute path or file:// URL, and Weft uploads it with the images, stylesheets and videos it names and shows it on both boards. Never tell the user to open a file on this machine: they can't reach it. Don't say the pane is unavailable. To show an image in a reply, put it in as ![what it shows](/absolute/path/to/file.png).
Write pages in ${SHOW_DIR} (e.g. ${SHOW_DIR}/<topic>.html) or in the project's folder. Only web files go up (HTML, images, video, audio, fonts, CSS, JS), and nothing from a dot folder. The page runs sandboxed, with no storage and no Weft login, so make it self-contained. It's read on a phone too: a viewport meta tag, a fluid layout, nothing fixed wider than 360px, tap-sized controls.
Every turn, before you reply, make sure the pane shows something current for this turn. When there's no page for your work yet (a plan, a commit, research, an answer), render it as a page and open it. When a long task is ahead, open the plan as a page first and tick steps off as they finish. An edited page doesn't refresh by itself: open_url it again.
open_url also takes a public https address. The pane can't reach this machine's dev servers yet, so open_url refuses localhost. The other browser tools (read_page, screenshot, click and so on) need the desktop app and don't work here; for a screenshot or a check of a page, use a tool installed on this machine.`;

// What a card's browser shows: "" with no page yet, undefined when the shell can't say (an older
// shell without the route, or no desktop app).
export async function paneUrl(key: string): Promise<string | undefined> {
  try {
    return asText((await shell("/browser/url", { key })).url);
  } catch {
    return undefined;
  }
}

// A small JPEG of a card's pane page for its thumbnail, or undefined (no page, off screen, no desktop app).
export async function paneThumb(key: string): Promise<Buffer | undefined> {
  try {
    const { jpg } = await shell("/browser/thumb", { key });
    return typeof jpg === "string" && jpg ? Buffer.from(jpg, "base64") : undefined;
  } catch {
    return undefined;
  }
}

// Loads a page in a card's browser for Weft itself (not an agent); shown if that card is on screen.
export async function openInPane(url: string, key: string) {
  await shell("/browser/open", { url, key });
  notePage(key, url);
}

export function savePng(file: string, base64: string) {
  if (!path.isAbsolute(file)) throw new Error(`save_to must be an absolute path, not ${file}`);
  const out = file.toLowerCase().endsWith(".png") ? file : `${file}.png`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(base64, "base64"));
  return out;
}

// A fresh server per query: an MCP server instance serves one connection. Each card drives its own
// browser, named by its id.
// A spare thread has no card until one takes it over, so the id is read when a tool runs.
export function browserMcpServer(cardId: () => string | undefined) {
  return createSdkMcpServer({
    name: "browser",
    version: "0.1.0",
    // Keep the tools in the prompt instead of behind tool search, so agents see them up front.
    alwaysLoad: true,
    tools: [
      tool(
        "open_url",
        "Open a URL in the browser pane beside the board and show the pane. new_tab opens it in a new tab and keeps the page on screen now in its own; the other tools act on the tab on screen.",
        { url: z.string(), new_tab: z.boolean().optional() },
        ({ url, new_tab }) =>
          attempt(async () => {
            if (onWorker()) return text(await openOnWorker(cardId(), url));
            const page = await shell("/browser/open", { url, key: cardId(), ...(new_tab ? { newTab: true } : {}) });
            noteUrl(cardId(), asText(page.url));
            notePage(cardId(), asText(page.url));
            // What Weft's cards learned about this page before, framed as untrusted reference (lib/site-notes-read.ts).
            const notes = await siteNotesForUrl(cardId(), asText(page.url));
            return text(`Opened ${asText(page.url)} — ${asText(page.title)}${notes ? `\n\n${notes}` : ""}`);
          }),
      ),
      tool("read_page", "Return the URL, title, and visible text of the page in the browser pane.", {}, () =>
        attempt(async () => {
          const page = await shell("/browser/text", { key: cardId() });
          noteUrl(cardId(), asText(page.url));
          return text(`URL: ${asText(page.url)}\nTitle: ${asText(page.title)}\n\n${asText(page.text)}`);
        }),
      ),
      tool(
        "screenshot",
        "Take a screenshot of the browser pane. save_to also writes it as a PNG (absolute path), so a page you write can show it; highlight draws an orange box around the element a CSS selector matches, e.g. the button a step says to click.",
        {
          save_to: z.string().optional().describe(`Absolute path to save the PNG at, e.g. ${SHOW_DIR}/setup/step-2.png`),
          highlight: z
            .string()
            .optional()
            .describe('CSS selector of the element to box in orange, or a text selector like :text-is("Continue")'),
        },
        ({ save_to, highlight }) =>
          attempt(async () => {
            const shot = await shell("/browser/screenshot", { key: cardId(), highlight });
            void recordExplore("screenshot");
            const content: ToolResult["content"] = [{ type: "image", data: String(shot.png), mimeType: "image/png" }];
            if (save_to) content.push({ type: "text", text: `Saved to ${savePng(save_to, String(shot.png))}` });
            if (highlight && shot.found === false) content.push({ type: "text", text: `No element matches ${highlight}; nothing was boxed.` });
            return { content };
          }),
      ),
      // Acting on the page: snapshot refs, trusted clicks and keys, waits, logs (lib/browser-act-tools.ts).
      ...actTools(cardId),
    ],
  });
}
