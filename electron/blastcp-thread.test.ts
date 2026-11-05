import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBlastcpThread, TOOLS_FILE } from "./blastcp-thread.cjs";

// A thread's mcp__blastcp__* calls, forwarded by main with the sealed sign-in (docs/architecture/blastcp.md#threads).
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "blastcp-thread-"));

type Answer = { status?: number; body?: unknown; stream?: boolean };
function fakeFetch(answer: (body: { method: string; params: Record<string, unknown> }) => Answer) {
  const sent: { method: string; params: Record<string, unknown>; auth: string }[] = [];
  const fetch = vi.fn((_url: string, init: { headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as { method: string; params: Record<string, unknown> };
    sent.push({ ...body, auth: init.headers.Authorization ?? "" });
    const { status = 200, body: out = {}, stream = false } = answer(body);
    const raw = typeof out === "string" ? out : JSON.stringify(out);
    return Promise.resolve({
      ok: status < 400,
      status,
      headers: { get: () => (stream ? "text/event-stream" : "application/json") },
      text: () => Promise.resolve(stream ? `event: message\ndata: ${raw}\n\n` : raw),
    });
  });
  return { fetch, sent };
}

const TOOLS = [{ name: "generate_image", inputSchema: { type: "object" } }];
const session = (expiresAt: number | null = null) => () => ({ token: "tok", expiresAt });

describe("createBlastcpThread", () => {
  it("forwards a tools/call with the sealed token and returns BlastCP's result", async () => {
    const { fetch, sent } = fakeFetch(() => ({ body: { result: { content: [{ type: "text", text: "made" }] } } }));
    const t = createBlastcpThread({ dataDir: tmp(), fetch, session: session() });
    expect(await t.forward("tools/call", { name: "generate_image", arguments: { prompt: "a car" } })).toEqual({ state: "ok", result: { content: [{ type: "text", text: "made" }] } });
    expect(sent[0]).toMatchObject({ method: "tools/call", params: { name: "generate_image", arguments: { prompt: "a car" } }, auth: "Bearer tok" });
  });

  it("reads an event-stream answer's data line", async () => {
    const { fetch } = fakeFetch(() => ({ stream: true, body: { result: { content: [] } } }));
    const t = createBlastcpThread({ dataDir: tmp(), fetch, session: session() });
    expect(await t.forward("tools/call", { name: "whoami" })).toEqual({ state: "ok", result: { content: [] } });
  });

  it("says off with no sign-in and expired past its expiry, without calling BlastCP", async () => {
    const { fetch } = fakeFetch(() => ({}));
    expect(await createBlastcpThread({ dataDir: tmp(), fetch, session: () => null }).forward("tools/call", { name: "x" })).toEqual({ state: "off" });
    expect(await createBlastcpThread({ dataDir: tmp(), fetch, session: session(5), now: () => 10 }).forward("tools/call", { name: "x" })).toEqual({ state: "expired" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says refused on a 401 and passes a JSON-RPC error on", async () => {
    const refused = createBlastcpThread({ dataDir: tmp(), fetch: fakeFetch(() => ({ status: 401, body: "revoked" })).fetch, session: session() });
    expect(await refused.forward("tools/call", { name: "x" })).toEqual({ state: "refused", message: "revoked" });
    const failed = createBlastcpThread({ dataDir: tmp(), fetch: fakeFetch(() => ({ body: { error: { message: "no such tool" } } })).fetch, session: session() });
    expect(await failed.forward("tools/call", { name: "x" })).toEqual({ state: "error", message: "no such tool" });
    const broken = createBlastcpThread({ dataDir: tmp(), fetch: fakeFetch(() => ({ status: 502, body: "<html>" })).fetch, session: session() });
    expect(await broken.forward("tools/call", { name: "x" })).toEqual({ state: "error", message: "BlastCP answered 502." });
  });

  it("forwards only tools/list and tools/call", async () => {
    const t = createBlastcpThread({ dataDir: tmp(), fetch: fakeFetch(() => ({})).fetch, session: session() });
    await expect(t.forward("resources/read", {})).rejects.toThrow(/don't forward resources\/read/);
  });

  it("lists from BlastCP the first time and keeps the list, then answers from it and refreshes behind", async () => {
    const dir = tmp();
    const { fetch } = fakeFetch(() => ({ body: { result: { tools: TOOLS } } }));
    const t = createBlastcpThread({ dataDir: dir, fetch, session: session() });
    expect(await t.forward("tools/list")).toEqual({ state: "ok", result: { tools: TOOLS } });
    expect((JSON.parse(fs.readFileSync(path.join(dir, TOOLS_FILE), "utf8")) as { tools: unknown }).tools).toEqual(TOOLS);
    expect(await t.forward("tools/list")).toEqual({ state: "ok", result: { tools: TOOLS } });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });

  it("lists the kept tools even while signed out, and says off with none kept", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, TOOLS_FILE), JSON.stringify({ tools: TOOLS }));
    const { fetch } = fakeFetch(() => ({}));
    expect(await createBlastcpThread({ dataDir: dir, fetch, session: () => null }).forward("tools/list")).toEqual({ state: "ok", result: { tools: TOOLS } });
    expect(await createBlastcpThread({ dataDir: tmp(), fetch, session: () => null }).forward("tools/list")).toEqual({ state: "off" });
    fs.writeFileSync(path.join(dir, TOOLS_FILE), "{}");
    expect(await createBlastcpThread({ dataDir: dir, fetch, session: () => null }).forward("tools/list")).toEqual({ state: "off" });
  });
});

describe("an answer with json() only", () => {
  it("reads it as JSON, as main's own fetch type allows", async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ result: { content: [] } }) }));
    const t = createBlastcpThread({ dataDir: tmp(), fetch, session: session() });
    expect(await t.forward("tools/call", { name: "x" })).toEqual({ state: "ok", result: { content: [] } });
  });
});
