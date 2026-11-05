import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { shell, type ToolResult } from "./browser-shell";
import { asText } from "./format";
import { onWorker } from "./worker-secret-run";

// BlastCP's MCP tools (generate_image, list_posts, …) for a thread, through Weft's own BlastCP sign-in
// (docs/architecture/blastcp.md#threads). This server only relays: each list and call goes to Electron main over
// the control server, main attaches the sealed token and asks blastcp.com, and only BlastCP's answer comes back.
// The tools are BlastCP's own, listed as it lists them, so a thread gets new ones without a Weft change.

export const BLASTCP_PROMPT = `To make an image (mcp__blastcp__generate_image) or use BlastCP (drafting, scheduling, a property's posts), use the mcp__blastcp__* tools: they go through Weft's own BlastCP sign-in from the 🚀 rail drawer. Prefer them over the claude.ai BlastCP connector, which is often not signed in. A picture the tool returns is saved under ~/.weft/show/blastcp and its path given; show it inline in your reply. If the tools say BlastCP isn't connected or its sign-in ran out, tell the user to click Connect (or Reconnect) in the 🚀 drawer on the left rail; don't send them to claude.ai.`;

// Always listed, so a thread that started before BlastCP was connected can still reach any of its tools.
export const CALL_TOOL: Tool = {
  name: "call",
  description: "Call one of BlastCP's tools by name, with its arguments: for a tool not listed here (BlastCP was connected after this thread started). Goes through Weft's BlastCP sign-in.",
  inputSchema: {
    type: "object",
    properties: { tool: { type: "string", description: "The BlastCP tool's name, e.g. generate_image" }, arguments: { type: "object", description: "Its arguments" } },
    required: ["tool"],
  },
};

const DRAWER = "🚀 on Weft's left rail";
export const NOT_CONNECTED = `BlastCP isn't connected in Weft. Ask the user to open ${DRAWER} and click Connect (Connect with Weft uses their Weft account), then try again. Don't send them to claude.ai.`;
export const RECONNECT = `Weft's BlastCP sign-in has run out. Ask the user to open ${DRAWER} and click Reconnect, then try again.`;
export const ON_WORKER = "BlastCP's tools go through the sign-in on the user's Mac, and this card runs on a Weft Worker, so they don't work here.";
export const RESTART = "This Weft's desktop side is from before BlastCP's thread tools landed. Ask the user to restart Weft (or call mcp__board__restart_weft_when_idle).";

type Forwarded = { state: "ok"; result: Record<string, unknown> } | { state: "off" | "expired" | "refused" | "error" | "unavailable"; message?: string };

const SHOW_DIR = () => path.join(process.env.WEFT_SHOW_DIR ?? path.join(os.homedir(), ".weft", "show"), "blastcp");

async function forward(method: string, params: Record<string, unknown>): Promise<Forwarded> {
  try {
    return (await shell("/blastcp/mcp", { method, params })) as Forwarded;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A main from before this landed has no such route.
    if (message === "Not found") return { state: "unavailable", message: RESTART };
    throw err;
  }
}

// Why a call couldn't reach BlastCP, in the words a thread passes on.
export function whyNot(got: Exclude<Forwarded, { state: "ok" }>): string {
  if (got.state === "off") return NOT_CONNECTED;
  if (got.state === "expired") return RECONNECT;
  if (got.state === "refused") return `BlastCP refused Weft's sign-in${got.message ? ` (${asText(got.message).slice(0, 200)})` : ""}. Ask the user to open ${DRAWER} and click Reconnect, then try again.`;
  if (got.state === "unavailable") return got.message ?? RESTART;
  return `BlastCP: ${got.message ?? "the call failed."}`;
}

export async function listTools(): Promise<Tool[]> {
  if (onWorker()) return [CALL_TOOL];
  const got = await forward("tools/list", {}).catch(() => null);
  const tools = got?.state === "ok" && Array.isArray(got.result.tools) ? (got.result.tools as Tool[]) : [];
  return [...tools.filter((t) => t.name !== CALL_TOOL.name), CALL_TOOL];
}

// An image BlastCP returns inline is written to the show folder too, so the thread can put it in its reply.
export function saveImages(result: ToolResult, dir = SHOW_DIR(), stamp = Date.now()): ToolResult {
  const saved: string[] = [];
  result.content.forEach((block, i) => {
    if (block.type !== "image") return;
    const ext = block.mimeType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
    const file = path.join(dir, `${stamp}-${i}.${ext}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(block.data, "base64"));
    saved.push(file);
  });
  if (!saved.length) return result;
  return { ...result, content: [...result.content, { type: "text", text: `Saved: ${saved.join(", ")}` }] };
}

export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  if (onWorker()) return { content: [{ type: "text", text: ON_WORKER }], isError: true };
  const [tool, input] = name === CALL_TOOL.name ? [asText(args.tool), (args.arguments as Record<string, unknown> | undefined) ?? {}] : [name, args];
  if (!tool) return { content: [{ type: "text", text: "Name the BlastCP tool to call." }], isError: true };
  try {
    const got = await forward("tools/call", { name: tool, arguments: input });
    if (got.state !== "ok") return { content: [{ type: "text", text: whyNot(got) }], isError: true };
    const result = got.result as unknown as ToolResult;
    return saveImages({ ...result, content: Array.isArray(result.content) ? result.content : [] });
  } catch (err) {
    return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true };
  }
}

// A fresh server per query, like Weft's others. Low-level handlers, since the tools are BlastCP's, not a fixed set.
export function blastcpMcpServer(): McpSdkServerConfigWithInstance {
  const instance = new McpServer({ name: "blastcp", version: "0.1.0" }, { capabilities: { tools: {} } });
  instance.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await listTools() }));
  instance.server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(req.params.name, req.params.arguments ?? {}));
  // An image can take a few minutes to render.
  return { type: "sdk", name: "blastcp", instance, timeout: 600_000 };
}
