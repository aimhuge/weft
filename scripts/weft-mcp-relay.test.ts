// The stdio relay an Antigravity thread runs for each of Weft's MCP servers (scripts/weft-mcp-relay.mjs), run for real
// as a child process against a tiny local HTTP server standing in for Weft's bridge (app/api/mcp/[server]).
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RELAY = path.join(__dirname, "weft-mcp-relay.mjs");

type Seen = { url: string; auth: string | undefined; type: string | undefined; accept: string | undefined; body: string };
const seen: Seen[] = [];
let server: http.Server;
let base: string;

// Each route answers as the bridge would, or as a broken one would.
const routes: Record<string, (body: string, res: http.ServerResponse) => void> = {
  "/json": (body, res) => {
    const msg = JSON.parse(body) as { id?: unknown; method: string };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(msg.id === undefined ? "" : JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echoed: msg.method } }));
  },
  "/batch": (_body, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify([{ jsonrpc: "2.0", id: 1, result: "a" }, { jsonrpc: "2.0", id: 2, result: "b" }]));
  },
  "/sse": (body, res) => {
    const msg = JSON.parse(body) as { id: unknown };
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" })}\n\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: "streamed" })}\n\n`);
  },
  "/empty-500": (_body, res) => {
    res.writeHead(500);
    res.end();
  },
  "/error-body": (body, res) => {
    const msg = JSON.parse(body) as { id: unknown };
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32001, message: "Unauthorized" } }));
  },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", auth: req.headers.authorization, type: req.headers["content-type"], accept: req.headers.accept, body });
      (routes[req.url ?? ""] ?? routes["/json"]!)(body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Runs the relay with these stdin lines, closes stdin, and resolves with its stdout lines and exit code. */
function relay(url: string | undefined, lines: string[], env: Record<string, string> = { WEFT_MCP_TOKEN: "tok-123" }) {
  return new Promise<{ out: Record<string, unknown>[]; code: number | null; stderr: string }>((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, url === undefined ? [RELAY] : [RELAY, url], { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ out: stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>), code, stderr }));
    child.stdin.end(lines.map((l) => `${l}\n`).join(""));
  });
}

const req = (id: number | string, method = "tools/list") => JSON.stringify({ jsonrpc: "2.0", id, method });

describe("weft-mcp-relay", () => {
  it("posts each line with the bearer token from its env, writes the answers, and exits 0 once stdin closes", async () => {
    seen.length = 0;
    const { out, code } = await relay(`${base}/json`, [req(1, "initialize"), req("two", "tools/list")]);
    expect(code).toBe(0);
    expect(out).toEqual(expect.arrayContaining([
      { jsonrpc: "2.0", id: 1, result: { echoed: "initialize" } },
      { jsonrpc: "2.0", id: "two", result: { echoed: "tools/list" } },
    ]));
    expect(out).toHaveLength(2);
    expect(seen.map((s) => s.auth)).toEqual(["Bearer tok-123", "Bearer tok-123"]);
    expect(seen[0]).toMatchObject({ url: "/json", type: "application/json", accept: "application/json, text/event-stream" });
    expect(seen.map((s) => JSON.parse(s.body) as unknown)).toEqual(expect.arrayContaining([JSON.parse(req(1, "initialize")), JSON.parse(req("two"))]));
  });

  it("sends an empty bearer token when it was given none", async () => {
    seen.length = 0;
    await relay(`${base}/json`, [req(1)], {});
    expect(seen[0]?.auth).toBe("Bearer");
  });

  it("writes nothing for a notification the bridge answers with an empty body", async () => {
    const { out, code } = await relay(`${base}/json`, [JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })]);
    expect([out, code]).toEqual([[], 0]);
  });

  it("writes each message of a batch answer", async () => {
    const { out } = await relay(`${base}/batch`, [req(1)]);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, result: "a" }, { jsonrpc: "2.0", id: 2, result: "b" }]);
  });

  it("writes each data line of an SSE body", async () => {
    const { out } = await relay(`${base}/sse`, [req(5)]);
    expect(out).toEqual([{ jsonrpc: "2.0", method: "notifications/progress" }, { jsonrpc: "2.0", id: 5, result: "streamed" }]);
  });

  it("answers a request with a JSON-RPC error when the bridge answers non-2xx with nothing, and a notification with nothing", async () => {
    const { out } = await relay(`${base}/empty-500`, [req(9), JSON.stringify({ jsonrpc: "2.0", method: "notifications/x" }), JSON.stringify({ jsonrpc: "2.0", id: null, method: "y" })]);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 9, error: { code: -32603, message: "Weft answered 500." } }]);
  });

  it("passes on the bridge's own error body when a non-2xx answer has one", async () => {
    const { out } = await relay(`${base}/error-body`, [req(3)]);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 3, error: { code: -32001, message: "Unauthorized" } }]);
  });

  it("answers a request with a JSON-RPC error when Weft isn't reachable", async () => {
    // A port nothing listens on: the server's own, once it's closed, would race other tests, so a fresh closed one.
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const { out, code } = await relay(`http://127.0.0.1:${port}/api/mcp/browser`, [req(4)]);
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ jsonrpc: "2.0", id: 4, error: { code: -32603 } });
    expect((out[0]?.error as { message: string }).message).toMatch(/^Weft's tools aren't reachable: /);
  });

  it("ignores blank lines and lines that aren't JSON", async () => {
    seen.length = 0;
    const { out, code } = await relay(`${base}/json`, ["", "   ", "not json", "{half", req(1)]);
    expect(code).toBe(0);
    expect(out).toEqual([{ jsonrpc: "2.0", id: 1, result: { echoed: "tools/list" } }]);
    expect(seen).toHaveLength(1);
  });

  it("exits 2 with its usage when it's given no url", async () => {
    const { code, stderr, out } = await relay(undefined, []);
    expect(code).toBe(2);
    expect(stderr).toContain("usage: weft-mcp-relay.mjs <url>");
    expect(out).toEqual([]);
  });
});
