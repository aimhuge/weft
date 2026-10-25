import fs from "node:fs";
import path from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { recordExplore } from "./explore";
import { asText } from "./format";
import { SHOW_DIR } from "./show-dir";
import { shellToken } from "./shell-token";

// The desktop shell (electron/main.cjs) passes these when it starts the Next server.
const SHELL_URL = process.env.WEFT_SHELL_URL;

export const BROWSER_PROMPT = `You are running inside Weft, a desktop app with a browser pane beside the user's board.
Use the mcp__browser__* tools to open pages there (for example a dev server you started), read them, take screenshots, and click or type. The user can see that pane.
Your replies are shown as Markdown. To show the user an image or video file (a screenshot you saved, a chart, a generated picture), put it in your reply as ![what it shows](/absolute/path/to/file.png) and it appears inline in the thread. Screenshots from your tools are shown to the user automatically.
Every turn, before you reply, make sure the pane shows something current for this turn: no exceptions for quick answers, questions, follow-ups or small fixes. If the pane is blank or shows an earlier step, open or update a page first. When there is no page for your work yet (a commit, a refactor, research, a plan, a diff, a test run), render what you're doing as one self-contained HTML file outside the project folder, in ${SHOW_DIR} (e.g. ${SHOW_DIR}/<topic>.html), where it stays after a restart: a timeline, a diagram, a before/after, stats, the plan as cards. Open it with mcp__browser__open_url and update it as the work moves. Make it worth looking at, not a copy of your reply. Once there's a real page for the work (the app, a dev server), show that instead.
When a long task is ahead of you (several steps, minutes of building), write your plan to a page and open it in one of your first tool calls, before you dig in: the steps as cards or a checklist, the one you're on marked. Then carry the plan out in the same turn: the page is not a stopping point, so don't end your turn to show it unless the user asked only for a plan. Tick steps off as they finish, so the user can watch the plan while you build.
When what you hand back is something the user has to do themselves (set up a domain, click through a dashboard, run commands), make it its own instructions page in its own folder (e.g. ${SHOW_DIR}/<topic>/index.html): numbered steps as <input type="checkbox"> items, links, commands in <code> to copy, an inline SVG diagram where a flow helps, and a screenshot for each step you can show. To take one, open the real site in the pane (the user is logged in there) and call mcp__browser__screenshot with save_to in that folder and highlight on what to click, then show it with a relative src. The user can star the page into their library and tick the steps off over days, so keep it self-contained.`;

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
};

export function text(value: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: value }], isError };
}

export async function shell(route: string, body?: Record<string, unknown>) {
  if (!SHELL_URL) throw new Error("The browser pane only exists in the desktop app (npm run desktop).");
  const res = await fetch(`${SHELL_URL}${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${shellToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(asText(data.error, res.statusText));
  return data;
}

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
}

export function savePng(file: string, base64: string) {
  if (!path.isAbsolute(file)) throw new Error(`save_to must be an absolute path, not ${file}`);
  const out = file.toLowerCase().endsWith(".png") ? file : `${file}.png`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(base64, "base64"));
  return out;
}

export async function attempt(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    return text(err instanceof Error ? err.message : String(err), true);
  }
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
      tool("open_url", "Open a URL in the browser pane beside the board and show the pane.", { url: z.string() }, ({ url }) =>
        attempt(async () => {
          const page = await shell("/browser/open", { url, key: cardId() });
          return text(`Opened ${asText(page.url)} — ${asText(page.title)}`);
        }),
      ),
      tool("read_page", "Return the URL, title, and visible text of the page in the browser pane.", {}, () =>
        attempt(async () => {
          const page = await shell("/browser/text", { key: cardId() });
          return text(`URL: ${asText(page.url)}\nTitle: ${asText(page.title)}\n\n${asText(page.text)}`);
        }),
      ),
      tool(
        "screenshot",
        "Take a screenshot of the browser pane. save_to also writes it as a PNG (absolute path), so a page you write can show it; highlight draws an orange box around the element a CSS selector matches, e.g. the button a step says to click.",
        {
          save_to: z.string().optional().describe(`Absolute path to save the PNG at, e.g. ${SHOW_DIR}/setup/step-2.png`),
          highlight: z.string().optional().describe("CSS selector of the element to box in orange"),
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
      tool("click", "Click the first element matching a CSS selector in the browser pane.", { selector: z.string() }, ({ selector }) =>
        attempt(async () => {
          const r = await shell("/browser/click", { selector, key: cardId() });
          return r.found ? text(`Clicked ${selector}`) : text(`No element matches ${selector}`, true);
        }),
      ),
      tool(
        "type_text",
        "Replace the contents of the input matching a CSS selector in the browser pane with text.",
        { selector: z.string(), text: z.string() },
        ({ selector, text: value }) =>
          attempt(async () => {
            const r = await shell("/browser/type", { selector, text: value, key: cardId() });
            return r.found ? text(`Typed into ${selector}`) : text(`No element matches ${selector}`, true);
          }),
      ),
    ],
  });
}
