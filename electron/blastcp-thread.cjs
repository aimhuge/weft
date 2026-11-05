// BlastCP's MCP tools for threads (docs/architecture/blastcp.md#threads): lib/blastcp-tools.ts asks the control
// server, and this forwards the request to blastcp.com/api/mcp with the sealed sign-in attached. Only the answer
// goes back; the token stays in main. Two methods only, so a thread can't use the sign-in for anything else.
const fs = require("node:fs");
const path = require("node:path");
const { ORIGIN } = require("./blastcp-oauth.cjs");

const TOOLS_FILE = "blastcp-tools.json";
const METHODS = new Set(["tools/list", "tools/call"]);

/** @typedef {{ ok: boolean, status: number, json?: () => Promise<any>, text?: () => Promise<string>, headers?: { get(name: string): string | null } }} Answer */
/** @typedef {(url: string, init: { method: string, headers: Record<string, string>, body: string }) => Promise<Answer>} Fetch */

/** @param {Answer} res */
const bodyOf = async (res) => (res.text ? res.text() : JSON.stringify(await res.json?.()));

// A streamable-HTTP answer may come as an event stream; its last data line is the JSON-RPC message.
/** @param {Answer} res */
async function messageOf(res) {
  const body = await bodyOf(res);
  if (!String(res.headers?.get?.("content-type") ?? "").includes("text/event-stream")) return JSON.parse(body);
  const data = body.split("\n").filter((l) => l.startsWith("data:")).pop();
  return JSON.parse(data ? data.slice(5) : "{}");
}

/**
 * @param {{ dataDir: string, fetch: Fetch, session: () => { token: string, expiresAt: number | null } | null, now?: () => number }} options
 */
function createBlastcpThread({ dataDir, fetch: fetchImpl, session, now = Date.now }) {
  const toolsFile = path.join(dataDir, TOOLS_FILE);
  let rpcId = 0;

  // The last tool list BlastCP gave, so a thread's start doesn't wait on blastcp.com. Tool schemas aren't secret.
  function cachedTools() {
    try {
      const tools = JSON.parse(fs.readFileSync(toolsFile, "utf8")).tools;
      return Array.isArray(tools) ? tools : null;
    } catch {
      return null;
    }
  }

  // One JSON-RPC request with the sign-in. { state: "ok", result } or why not: off (not connected), expired, refused, error.
  async function send(method, params) {
    const s = session();
    if (!s) return { state: "off" };
    if (s.expiresAt !== null && Number(s.expiresAt) <= now()) return { state: "expired" };
    const res = await fetchImpl(`${ORIGIN}/api/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    if (res.status === 401 || res.status === 403) return { state: "refused", message: await bodyOf(res).catch(() => "") };
    const data = await messageOf(res).catch(() => ({}));
    if (!res.ok || data.error) return { state: "error", message: data.error?.message ?? `BlastCP answered ${res.status}.` };
    return { state: "ok", result: data.result ?? {} };
  }

  async function refreshTools() {
    const got = await send("tools/list", {});
    if (got.state === "ok" && Array.isArray(got.result.tools)) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(toolsFile, JSON.stringify({ tools: got.result.tools, at: now() }));
    }
    return got;
  }

  return {
    // tools/list answers from the cache and refreshes it behind; with no cache yet it waits for BlastCP.
    async forward(method, params = {}) {
      if (!METHODS.has(method)) throw new Error(`BlastCP's thread tools don't forward ${method}.`);
      if (method === "tools/call") return send(method, { name: String(params.name ?? ""), arguments: params.arguments ?? {} });
      const cached = cachedTools();
      if (cached) {
        refreshTools().catch(() => {});
        return { state: "ok", result: { tools: cached } };
      }
      return refreshTools();
    },
  };
}

module.exports = { createBlastcpThread, TOOLS_FILE };
