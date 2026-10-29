import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, savePng, shell, text, type ToolResult } from "./browser-tools";
import { asText } from "./format";
import { SHOW_DIR } from "./show-dir";

// mcp__board_view__*: a thread sees and drives Weft's own board window, so a change to a drawer, dialog or
// card can be checked in the real app instead of only in jsdom. The desktop shell runs a fixed set of
// operations (electron/board-view.cjs); there's no arbitrary JS, and secret values read as ‹secret›.
// It's the user's live window: every click lands in front of them.
export function boardViewMcpServer() {
  return createSdkMcpServer({
    name: "board_view",
    version: "0.1.0",
    alwaysLoad: true,
    tools: [
      tool(
        "screenshot",
        "Take a screenshot of Weft's own board window (not the browser pane). save_to also writes it as a PNG (absolute path); highlight boxes the element a CSS selector matches. Secret values show as hatched blocks.",
        {
          save_to: z.string().optional().describe(`Absolute path to save the PNG at, e.g. ${SHOW_DIR}/board/dialog.png`),
          highlight: z
            .string()
            .optional()
            .describe('CSS selector of the element to box in orange, or a text selector like :text-is("Continue")'),
        },
        ({ save_to, highlight }) =>
          attempt(async () => {
            const shot = await shell("/board-view/screenshot", { highlight });
            const content: ToolResult["content"] = [{ type: "image", data: String(shot.png), mimeType: "image/png" }];
            if (save_to) content.push({ type: "text", text: `Saved to ${savePng(save_to, String(shot.png))}` });
            if (highlight && shot.found === false) content.push({ type: "text", text: `No element matches ${highlight}; nothing was boxed.` });
            return { content };
          }),
      ),
      tool(
        "click",
        "Click the first element matching a CSS selector on Weft's board window. A text selector works too: :text-is(\"Settings…\"), :has-text(\"menu\"). Reveal and copy controls for secrets are refused.",
        { selector: z.string() },
        ({ selector }) =>
          attempt(async () => {
            await shell("/board-view/click", { selector });
            return text(`Clicked ${selector}`);
          }),
      ),
      tool(
        "hover",
        "Move the mouse over the first element matching a CSS selector on Weft's board window, so hover-only controls appear. A text selector works too: :text-is(\"Settings…\").",
        { selector: z.string() },
        ({ selector }) =>
          attempt(async () => {
            await shell("/board-view/hover", { selector });
            return text(`Hovering ${selector}`);
          }),
      ),
      tool(
        "type_text",
        "Replace the contents of the text field matching a CSS selector on Weft's board window with text. A text selector works too: :text-is(\"Search\").",
        { selector: z.string(), text: z.string() },
        ({ selector, text: value }) =>
          attempt(async () => {
            await shell("/board-view/type", { selector, text: value });
            return text(`Typed into ${selector}`);
          }),
      ),
      tool(
        "read",
        "Return the visible text of Weft's board window, or of the element a CSS selector matches. Secret values read as ‹secret›.",
        { selector: z.string().optional() },
        ({ selector }) =>
          attempt(async () => {
            const page = await shell("/board-view/read", { selector });
            return text(`URL: ${asText(page.url)}\nTitle: ${asText(page.title)}\n\n${asText(page.text)}`);
          }),
      ),
    ],
  });
}
