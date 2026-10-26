import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { attempt, shell, text, type ToolResult } from "./browser-shell";
import { asText } from "./format";
import { noteSnapshot, recordStep, type StepArgs } from "./site-notes-trail";

// mcp__browser__* for acting on the pane's page: an accessibility snapshot with refs, trusted clicks, keys and
// typing, select, scroll, waits, the viewport, and the page's console and failed requests. Electron main does
// them through one CDP session per page (electron/pane-cdp.cjs, electron/pane-input.cjs;
// docs/architecture/agent-browser.md).

const target = {
  ref: z.string().optional().describe("The element's ref from snapshot, like e42 (preferred)"),
  selector: z.string().optional().describe("A CSS selector, when there's no ref"),
};

type Entry = Record<string, unknown>;

function consoleLine(e: Entry) {
  const at = asText(e.at);
  return `[${asText(e.level)}] ${asText(e.text)}${at ? `  (${at})` : ""}`;
}

function networkLine(e: Entry) {
  const what = `${asText(e.method)} ${asText(e.url)}${e.type ? ` (${asText(e.type)})` : ""}`;
  return e.status ? `${asText(e.status)} ${what}` : `failed ${what}: ${asText(e.error)}`;
}

function list(entries: unknown, line: (e: Entry) => string, none: string) {
  const items = Array.isArray(entries) ? (entries as Entry[]) : [];
  return items.length ? items.map(line).join("\n") : none;
}

// cardId names the card whose page they act on; read when a tool runs, since a spare thread has no card yet.
export function actTools(cardId: () => string | undefined) {
  const on = (route: string, body: Record<string, unknown>) => shell(`/browser/${route}`, { ...body, key: cardId() });
  const label = (args: { ref?: string; selector?: string }) => args.ref ?? args.selector ?? "";
  // An action on the page, kept in the card's trail for its site notes (lib/site-notes-trail.ts): by label, never by value.
  const act = (name: string, args: StepArgs, run: () => Promise<ToolResult>) =>
    attempt(run).then((r) => {
      const first = r.content[0];
      recordStep(cardId(), name, args, !r.isError, r.isError && first?.type === "text" ? first.text : undefined);
      return r;
    });
  return [
    tool(
      "snapshot",
      "The page in the browser pane as an outline of its elements (roles, names, values, states), with a ref on each one you can act on. Cheaper and more exact than a screenshot: take one, then click, type or hover by ref. Refs stay valid while the element is on the page.",
      {},
      () =>
        attempt(async () => {
          const r = await on("snapshot", {});
          noteSnapshot(cardId(), `URL: ${asText(r.url)}\n${asText(r.text)}`);
          const more = Number(r.dropped) > 0 ? `\n… ${String(r.dropped)} more elements didn't fit; scroll or use read_page for the rest.` : "";
          return text(`URL: ${asText(r.url)}\nTitle: ${asText(r.title)}\n\n${asText(r.text)}${more}`);
        }),
    ),
    tool(
      "click",
      "Click an element in the browser pane, by ref (from snapshot) or CSS selector, with a real mouse click. Fails, naming what's in the way, when something covers it.",
      { ...target, double: z.boolean().optional().describe("Double-click") },
      (args) =>
        act("click", args, async () => {
          await on("click", args);
          return text(`Clicked ${label(args)}`);
        }),
    ),
    tool("hover", "Move the mouse over an element in the browser pane, so hover menus and tooltips open.", target, (args) =>
      act("hover", args, async () => {
        await on("hover", args);
        return text(`Hovering over ${label(args)}`);
      }),
    ),
    tool(
      "type_text",
      "Replace the contents of a text field in the browser pane (by ref or CSS selector) with text, typed so the page's own handlers run. submit presses Enter after.",
      { ...target, text: z.string(), submit: z.boolean().optional().describe("Press Enter after typing") },
      (args) =>
        act("type_text", args, async () => {
          await on("type", args);
          return text(`Typed into ${label(args)}${args.submit ? " and pressed Enter" : ""}`);
        }),
    ),
    tool(
      "press_key",
      'Press a key or combo in the browser pane: "Enter", "Escape", "Tab", "Shift+Tab", "ArrowDown", "Meta+a". With a ref or selector, focuses that element first.',
      { keys: z.string(), ...target },
      (args) =>
        act("press_key", args, async () => {
          await on("press", args);
          return text(`Pressed ${args.keys}`);
        }),
    ),
    tool(
      "select_option",
      "Choose an option in a <select> in the browser pane, by the option's value or its visible label. Several values for a multi-select.",
      { ...target, values: z.array(z.string()).min(1) },
      (args) =>
        act("select_option", args, async () => {
          const r = await on("select", args);
          return text(`Selected ${(r.picked as string[]).join(", ")}`);
        }),
    ),
    tool(
      "scroll",
      "Scroll the browser pane's page (or the scrolling box under an element) up, down, left or right by amount pixels (default 600); with only a ref or selector, scroll that element into view.",
      { ...target, direction: z.enum(["up", "down", "left", "right"]).optional(), amount: z.number().optional() },
      (args) =>
        act("scroll", args, async () => {
          const r = await on("scroll", args);
          if (r.scrolled) return text(`Scrolled ${asText(r.scrolled)} into view`);
          return text(`Scrolled ${args.direction ?? "down"}; now at ${String(r.scrollY)}px of ${String(r.height)}px (${String(r.viewport)}px visible)`);
        }),
    ),
    tool(
      "wait_for",
      "Wait until text shows up on the page in the browser pane, until text is gone, or until a CSS selector matches something visible. Up to timeout_ms (default 5000, at most 30000).",
      {
        text: z.string().optional(),
        gone: z.string().optional().describe("Text to wait to disappear, like a spinner's Loading…"),
        selector: z.string().optional(),
        timeout_ms: z.number().optional(),
      },
      ({ timeout_ms, ...args }) =>
        attempt(async () => {
          const r = await on("wait", { ...args, timeout: timeout_ms });
          return text(`Done after ${String(r.waitedMs)}ms`);
        }),
    ),
    tool(
      "set_viewport",
      'Render the browser pane\'s page at a phone (390×844, touch) or tablet (820×1180) size, or a width and height, to check a responsive layout; "desktop" goes back to the pane\'s own size. Stays until changed.',
      { size: z.enum(["phone", "tablet", "desktop"]).optional(), width: z.number().optional(), height: z.number().optional() },
      (args) =>
        attempt(async () => {
          const r = await on("viewport", args);
          return text(`The page now lays out at ${String(r.width)}×${String(r.height)}`);
        }),
    ),
    tool(
      "console_logs",
      "The page's console messages and uncaught errors since it last loaded in the browser pane. level: error, warn (errors and warnings, the default) or all.",
      { level: z.enum(["error", "warn", "all"]).optional() },
      (args) =>
        attempt(async () => {
          const r = await on("console", args);
          const none = args.level === "all" ? "Nothing in the console" : args.level === "error" ? "No errors" : "No errors or warnings";
          return text(list(r.entries, consoleLine, `${none} since this page loaded.`));
        }),
    ),
    tool("network_errors", "Requests from the page in the browser pane that failed or got a 4xx/5xx since it last loaded.", {}, () =>
      attempt(async () => {
        const r = await on("network", {});
        return text(list(r.entries, networkLine, "No failed requests since this page loaded."));
      }),
    ),
  ];
}
