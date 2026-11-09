// What Weft's own MCP tools do on a Weft Worker today, in one table (docs/architecture/project-hosts.md#board-tools-on-a-worker).
// Every server is mounted on a worker (lib/weft-mcp.ts), so without this a thread learnt a tool fails there only by
// calling it. The table drives three things: the thread's prompt (lib/weft-prompts.ts keeps a group's own prompt only
// when some of its tools work, and lists what doesn't with why), and a PreToolUse hook (lib/guards/hooks.ts) that
// answers a call to a tool that doesn't work with the same why, before it runs.
//
// When a tool lands on workers, flip its entry to true here: that's the whole change.
import type { HookCallback, HookCallbackMatcher } from "@anthropic-ai/claude-agent-sdk";
import { onWorker } from "./worker-pane";

// true: works on a worker. A string: why it doesn't yet, as the thread reads it. "*" is every tool of the server not named.
export type ServerCaps = Record<string, true | string>;

const NO_PANE = "the browser pane is on the user's Mac, and a worker has no headless browser to drive yet";
const NO_TUNNEL = "a worker has no Weft session or tunnel yet, so a dev server or webhook here can't be reached from outside";

export const WORKER_TOOLS: Record<string, ServerCaps> = {
  browser: { open_url: true, "*": `${NO_PANE}. Write what you want to show as an HTML page in the show folder and open_url it.` },
  // Every vault tool reaches the vault on the owner's Mac (lib/worker-vault.ts, lib/secret-ask.ts, lib/worker-secret-run.ts),
  // each write or use behind Touch ID there; request_access answers that each call will ask. fill_field types into the Mac's
  // pane, which a worker's pages aren't (secrets.md#fill_field-on-a-weft-worker-not-planned).
  secrets: {
    fill_field: "it types into the browser pane on the user's Mac, which this worker's pages aren't. For a command use mcp__secrets__run; for a page, ask the user to fill the field on their Mac",
    "*": true,
  },
  webhooks: { list: true, add_blank: true, mark_registered: true, "*": `${NO_TUNNEL}. Record it with add_blank; the user registers it from their Mac.` },
  devservers: { "*": true },
  board_view: { "*": "it drives Weft's own window, which is on the user's Mac, not this worker" },
  board: {
    restart_weft_when_idle: "there's no Weft app to restart on a worker",
    request_folder_access: "macOS folder prompts are the Mac's; a worker's threads work in its own checkouts",
    "*": true,
  },
  simulator: { "*": true },
  // Not an MCP server: the gog CLI (GOG_PROMPT) isn't installed on a worker, and signing it in needs a browser.
  gog: { "*": "the gog CLI isn't installed on workers yet, and signing it in to Google needs the user's browser" },
};

// Why a tool doesn't work on a worker, or null when it does (or isn't one of Weft's).
export function workerToolGap(toolName: string, table = WORKER_TOOLS): string | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName);
  const caps = m ? table[m[1] as string] : undefined;
  if (!caps || !m) return null;
  const cap = caps[m[2] as string] ?? caps["*"] ?? true;
  return cap === true ? null : cap;
}

// Whether any of a group's tools work on a worker, so its own prompt is worth keeping there.
export function groupWorks(group: string, table = WORKER_TOOLS): boolean {
  const caps = table[group];
  return !caps || Object.values(caps).some((cap) => cap === true);
}

// The worker's part of a thread's prompt: what doesn't work here yet, by group, with why.
export function workerToolsPrompt(table = WORKER_TOOLS): string {
  const lines = Object.entries(table).flatMap(([group, caps]) => {
    const off = Object.entries(caps).filter(([, cap]) => cap !== true) as [string, string][];
    return off.map(([tool, why]) => {
      const works = Object.entries(caps).filter(([name, cap]) => cap === true && name !== "*").map(([name]) => name);
      const name = group === "gog" ? "the gog CLI" : tool === "*" ? `mcp__${group}__*${works.length ? ` (all but ${works.join(", ")})` : ""}` : `mcp__${group}__${tool}`;
      return `- ${name}: ${why}`;
    });
  });
  return `On this Weft Worker some of Weft's tools don't work yet; each answers with why if you call it, so don't:\n${lines.join("\n")}\nThe board tools (mcp__board__*) work on the user's real board: list_cards reads it, create_card starts a card here for this worker's projects or sends it to the user's Mac or another worker for theirs (name one by the folder list_cards shows: mac://<Mac name>/<path>, worker://<id>/<name>), crons and webhooks you make here run here and show in the user's drawers. create_agent can't save from a worker. Changelog entries land in this checkout's CHANGELOG.md with your commit, as on the Mac.`;
}

const gate: HookCallback = (input) => {
  if (input.hook_event_name !== "PreToolUse" || !onWorker()) return Promise.resolve({});
  const why = workerToolGap(input.tool_name);
  return Promise.resolve(
    why
      ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `${input.tool_name.replace(/^mcp__/, "")} doesn't work on a Weft Worker yet: ${why}.` } }
      : {},
  );
};

// For PreToolUse (lib/guards/hooks.ts). Every tool reaches it; workerToolGap only names Weft's own MCP tools.
export const WORKER_TOOL_GATE: HookCallbackMatcher = { hooks: [gate] };
