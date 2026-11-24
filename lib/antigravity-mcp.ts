import path from "node:path";
import { BRIDGE_TOKEN_ENV, openBridge } from "./mcp-bridge";
import type { Session } from "./runner-state";
import { weftMcpServers } from "./weft-mcp";

// Weft's own tools (browser, board, secrets…) for an Antigravity thread (docs/architecture/antigravity.md). agy takes
// MCP servers per ACP session in session/new, and in 1.5.16 only stdio ones (its initialize names no HTTP support).
// So each of Weft's servers is a small relay (scripts/weft-mcp-relay.mjs) to the same HTTP bridge Codex and Goose use
// (lib/mcp-bridge.ts). The bridge's token goes in each relay's own env, which agy passes to that server alone: it is
// never in agy's env, so the model's shell can't print it. Nothing is written to ~/.gemini.
//
// agy names a server's tools mcp_<server>_<tool>; lib/antigravity-tools.ts turns them back into mcp__<server>__<tool>.

export type AcpMcpServer = { name: string; command: string; args: string[]; env: { name: string; value: string }[] };

/** The ACP mcpServers entries for these servers: a relay each, with the token in its own env. */
export function acpMcpServers(origin: string, names: string[], token: string, node: string, relay: string): AcpMcpServer[] {
  return names.map((name) => ({
    name,
    command: node,
    args: [relay, `${origin}/api/mcp/${name}`],
    // Electron's binary runs the relay as plain Node only when asked to; Node ignores the variable.
    env: [{ name: BRIDGE_TOKEN_ENV, value: token }, { name: "ELECTRON_RUN_AS_NODE", value: "1" }],
  }));
}

/** The relay script, from Weft's own folder (the server runs from it). */
export function relayScript(weftDir = process.cwd()): string {
  return path.join(weftDir, "scripts", "weft-mcp-relay.mjs");
}

/**
 * Opens Weft's tools to the session's Antigravity process: a bridge token and the servers that reach it. Returns them
 * and what closes the bridge, once the process ends. None outside the server (no PORT): agy then has its own tools only.
 */
export function openAgyMcp(session: Session, port = process.env.PORT): { servers: AcpMcpServer[]; close: () => void } {
  if (!port) return { servers: [], close: () => {} };
  const servers = () => weftMcpServers(session.spec, () => session.cardId ?? undefined);
  const names = Object.keys(servers());
  const bridge = openBridge(servers);
  return { servers: acpMcpServers(`http://127.0.0.1:${port}`, names, bridge.token, process.execPath, relayScript()), close: bridge.close };
}
