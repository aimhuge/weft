import { asText } from "./format";
import { shellToken } from "./shell-token";

// What every Weft MCP tool uses to reach Electron main: the pane's token-guarded control server. The desktop
// shell (electron/main.cjs) passes its URL when it starts the Next server.
const SHELL_URL = process.env.WEFT_SHELL_URL;

export type ToolResult = {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
};

export function text(value: string, isError = false): ToolResult {
  return { content: [{ type: "text", text: value }], isError };
}

export async function shell(route: string, body?: Record<string, unknown>) {
  if (!SHELL_URL) throw new Error(process.env.WEFT_WORKER === "1" ? "This needs the desktop app, and this card runs on a Weft Worker. mcp__browser__open_url still works here, for pages you write." : "The browser pane only exists in the desktop app (npm run desktop).");
  const res = await fetch(`${SHELL_URL}${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${shellToken()}`, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(asText(data.error, res.statusText));
  return data;
}

// A tool's body: whatever it throws comes back as an error result the agent can read.
export async function attempt(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (err) {
    return text(err instanceof Error ? err.message : String(err), true);
  }
}
