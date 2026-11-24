#!/usr/bin/env node
// One of Weft's MCP servers, for a CLI that only starts stdio servers (Antigravity over ACP, lib/antigravity-mcp.ts).
// Each JSON-RPC line on stdin is posted to Weft's streamable-HTTP bridge (app/api/mcp/[server], stateless, plain JSON
// answers) with the thread's bearer token, and the answer goes back as one line on stdout. The token comes in this
// process's own env (WEFT_MCP_TOKEN), set by Weft for this server alone, so the CLI's env and its shell never hold it.
//
//   node weft-mcp-relay.mjs <url>
import readline from "node:readline";

const url = process.argv[2];
const token = process.env.WEFT_MCP_TOKEN ?? "";

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function failed(id, message) {
  if (id !== undefined && id !== null) write({ jsonrpc: "2.0", id, error: { code: -32603, message } });
}

// An SSE body's data lines, for a server that streams despite asking it not to.
function messagesIn(body, type) {
  if (!body.trim()) return [];
  if (!type.includes("text/event-stream")) {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return body.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
}

async function relay(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: line,
    });
    const body = await res.text();
    if (!res.ok && !body.trim()) return failed(message.id, `Weft answered ${res.status}.`);
    for (const answer of messagesIn(body, res.headers.get("content-type") ?? "")) write(answer);
  } catch (err) {
    failed(message.id, `Weft's tools aren't reachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

if (!url) {
  process.stderr.write("usage: weft-mcp-relay.mjs <url>\n");
  process.exit(2);
}
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const inFlight = new Set();
lines.on("line", (line) => {
  if (!line.trim()) return;
  const done = relay(line).finally(() => inFlight.delete(done));
  inFlight.add(done);
});
lines.on("close", () => void Promise.all(inFlight).then(() => process.exit(0)));
