import { PassThrough } from "node:stream";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { lineRedactor, main, readStdin, HOLD_CHARS } from "./secret-env.cjs";

const VALUE = "sk_live_wrapper_secret_1234";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-secret-env-"));
const server = path.join(dir, "server.js");
fs.writeFileSync(server, "console.log('key=' + process.env.API_KEY + ' port=' + process.env.PORT + ' token=' + (process.env.WEFT_SHELL_TOKEN || 'none')); process.stdout.write('partial ' + process.env.API_KEY);");

const sink = () => {
  let text = "";
  return { write: (c: string) => (text += c), text: () => text };
};

function stdinOf(text: string) {
  const s = new PassThrough();
  s.end(text);
  return s;
}

describe("lineRedactor", () => {
  it("writes whole redacted lines and holds a partial one until it ends", () => {
    const out = sink();
    const w = lineRedactor((t: string) => t.split(VALUE).join("‹K›"), out);
    w.write(`a ${VALUE.slice(0, 5)}`);
    expect(out.text()).toBe("");
    w.write(`${VALUE.slice(5)}\nb`);
    expect(out.text()).toBe("a ‹K›\n");
    w.flush();
    w.flush();
    expect(out.text()).toBe("a ‹K›\nb");
    w.write("y".repeat(HOLD_CHARS + 1));
    expect(out.text().length).toBe(7 + HOLD_CHARS + 1);
  });
});

describe("readStdin", () => {
  it("parses one JSON object, or rejects", async () => {
    expect(await readStdin(stdinOf('{"a":1}'))).toEqual({ a: 1 });
    await expect(readStdin(stdinOf("nope"))).rejects.toThrow();
  });
});

describe("main", () => {
  it("claims the grant and runs the command with the values, its output redacted", async () => {
    const claims: unknown[] = [];
    const srv = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        claims.push({ auth: req.headers.authorization, url: req.url, body: JSON.parse(body) as unknown });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ env: { API_KEY: VALUE } }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const stdout = sink();
    const stderr = sink();
    const code = await new Promise<number>((resolve) => {
      void main({
        stdin: stdinOf(JSON.stringify({ url, token: "tok", grant: "g1", argv: [process.execPath, server], env: { PORT: "3001" } })),
        stdout,
        stderr,
        env: { PATH: process.env.PATH, WEFT_SHELL_TOKEN: "tok" },
        exit: resolve,
        onSignal: () => {},
      });
    });
    srv.close();
    expect(claims).toEqual([{ auth: "Bearer tok", url: "/secrets/claim", body: { grant: "g1" } }]);
    expect(code).toBe(0);
    expect(stdout.text()).toBe("key=‹API_KEY› port=3001 token=none\npartial ‹API_KEY›");
    expect(stderr.text()).toBe("");
  });

  it("forwards signals, reports spawn errors and a signal exit", async () => {
    const { EventEmitter } = await import("node:events");
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const stderr = sink();
    await main({
      stdin: stdinOf(JSON.stringify({ url: "http://x", token: "t", grant: "g", argv: ["dev"], env: {} })),
      stdout: sink(),
      stderr,
      env: {},
      fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ env: { K: "value-12345" } }) }),
      spawnImpl: () => child,
      exit: (c: number) => exits.push(c),
      onSignal: (sig: string, fn: () => void) => handlers.set(sig, fn),
    });
    handlers.get("SIGTERM")!();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    child.stderr.emit("data", "oops value-12345\n");
    child.emit("error", new Error("ENOENT"));
    child.emit("close", null, "SIGTERM");
    child.emit("close", null, null);
    expect(stderr.text()).toBe("oops ‹K›\nENOENT\n");
    expect(exits).toEqual([1, 1, 0]);
  });

  it("on a worker, takes the values from stdin and claims nothing (lib/worker-dev-env.ts)", async () => {
    const fetchImpl = vi.fn();
    const stdout = sink();
    const code = await new Promise<number>((resolve) => {
      void main({
        stdin: stdinOf(JSON.stringify({ values: { API_KEY: VALUE }, argv: [process.execPath, server], env: { PORT: "3002" } })),
        stdout,
        stderr: sink(),
        env: { PATH: process.env.PATH },
        fetchImpl,
        exit: resolve,
        onSignal: () => {},
      });
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(code).toBe(0);
    expect(stdout.text()).toBe("key=‹API_KEY› port=3002 token=none\npartial ‹API_KEY›");
  });

  it("exits 1 when the grant can't be claimed", async () => {
    const stderr = sink();
    const exits: number[] = [];
    await main({
      stdin: stdinOf(JSON.stringify({ url: "http://x", token: "t", grant: "g", argv: ["dev"] })),
      stderr,
      fetchImpl: () => Promise.resolve({ ok: false, statusText: "Server Error", json: () => Promise.resolve({ error: "That grant was already used or has expired." }) }),
      exit: (c: number) => exits.push(c),
    });
    await main({
      stdin: stdinOf(JSON.stringify({ url: "http://x" })),
      stderr,
      fetchImpl: () => Promise.resolve({ ok: false, statusText: "Server Error", json: () => Promise.resolve({}) }),
      exit: (c: number) => exits.push(c),
    });
    expect(stderr.text()).toBe("Weft couldn't get the vault's secrets: That grant was already used or has expired.\nWeft couldn't get the vault's secrets: Server Error\n");
    expect(exits).toEqual([1, 1]);
  });
});
