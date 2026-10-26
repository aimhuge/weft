// Weft's own tools (browser, board, secrets, webhooks…) for a Goose turn (docs/architecture/goose.md).
//
// Goose can't take Weft's MCP servers in-process the way Claude Code does, so it reaches them over HTTP, like
// Codex: app/api/mcp/[server] serves them to a turn that holds that turn's bridge token (lib/mcp-bridge.ts).
// `goose run --with-streamable-http-extension` takes a URL and no header, and a token on the command line is
// readable by anything that can list processes, so the extensions go in the card's own Goose config file
// instead (<state root>/config/config.yaml, mode 0600), which Goose reads at start. The file holds only Weft's
// extensions; it is written before the turn and removed after it, and the token dies with the turn either way.
//
// Each extension is named mcp__<server>, so Goose calls its tools mcp__browser__open_url and so on: the names
// Weft's instructions give and the thread already knows how to show.
import fs from "node:fs";
import path from "node:path";
import { openBridge } from "./mcp-bridge";
import { gooseStateRoot } from "./goose-state";
import type { Session } from "./runner-state";
import { weftMcpServers } from "./weft-mcp";

// How long one of Weft's tools may take, in seconds: a vault fill waits on the user's Touch ID.
const TOOL_TIMEOUT = 600;

/** The card's Goose config file, which Goose reads from its state root. */
export function gooseConfigFile(cardId: string): string {
  return path.join(gooseStateRoot(cardId), "config", "config.yaml");
}

/** The config that gives Goose each of the turn's servers as a streamable-HTTP extension holding the token. */
export function gooseMcpConfig(origin: string, names: string[], token: string): string {
  const lines = ["extensions:"];
  for (const name of names) {
    const id = JSON.stringify(`mcp__${name}`);
    lines.push(
      `  ${id}:`,
      "    enabled: true",
      "    type: streamable_http",
      `    name: ${id}`,
      `    uri: ${JSON.stringify(`${origin}/api/mcp/${name}`)}`,
      "    headers:",
      `      Authorization: ${JSON.stringify(`Bearer ${token}`)}`,
      `    timeout: ${TOOL_TIMEOUT}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Opens Weft's tools to the session's next Goose turn: a bridge token and the config that points Goose at it.
 * Returns what closes them again, once the turn is over. Nothing is opened outside the server (no PORT) or
 * for a session with no card, whose Goose state has no folder of its own.
 */
export function openGooseMcp(session: Session, port = process.env.PORT): () => void {
  const cardId = session.cardId;
  if (!port || !cardId) return () => {};
  const servers = () => weftMcpServers(session.spec, () => session.cardId ?? undefined);
  const names = Object.keys(servers());
  if (!names.length) return () => {};
  const bridge = openBridge(servers);
  const file = gooseConfigFile(cardId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, gooseMcpConfig(`http://127.0.0.1:${port}`, names, bridge.token), { mode: 0o600 });
  } catch (err) {
    // Without the file the turn still runs, on Goose's own tools.
    console.error(`Couldn't give Goose Weft's tools for ${cardId}.`, err);
  }
  return () => {
    bridge.close();
    fs.rmSync(file, { force: true });
  };
}
