import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcpClient, AcpError, ACP_CLIENT_CODE } from "./acp-client";

// The Agent Client Protocol client Weft drives `agy acp` with (lib/acp-client.ts): JSON-RPC lines both ways, the
// agent's requests answered, its notifications handled in order, and every waiting request failed when it goes away.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function rig(onRequest = vi.fn<(m: string, p: unknown) => Promise<unknown>>(), onNotification = vi.fn<(m: string, p: unknown) => void | Promise<void>>()) {
  const lines: string[] = [];
  const write = vi.fn((line: string) => void lines.push(line));
  const client = new AcpClient(write, onRequest, onNotification);
  return { client, write, onRequest, onNotification, sent: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>), lines };
}

afterEach(() => vi.restoreAllMocks());

describe("AcpClient.request", () => {
  it("writes one JSON-RPC line per request, numbered from 1, and resolves with the matching answer", async () => {
    const r = rig();
    const first = r.client.request("initialize", { protocolVersion: 1 });
    const second = r.client.request("session/new", { cwd: "/p" });
    expect(r.lines.every((l) => l.endsWith("\n"))).toBe(true);
    expect(r.sent()).toEqual([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } },
      { jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: "/p" } },
    ]);
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { sessionId: "S" } }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } }));
    expect(await second).toEqual({ sessionId: "S" });
    expect(await first).toEqual({ protocolVersion: 1 });
  });

  it("rejects with the agent's error, its code kept, or a word of its own when the error has no message", async () => {
    const r = rig();
    const a = r.client.request("session/load", {});
    const b = r.client.request("session/load", {});
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "no such session" } }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 2, error: {} }));
    const err = await a.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AcpError);
    expect(err).toMatchObject({ name: "AcpError", message: "no such session", code: -32002 });
    await expect(b).rejects.toThrow("The agent answered with an error.");
  });

  it("ignores an answer to a request nobody is waiting on, and a second answer to the same one", async () => {
    const r = rig();
    const p = r.client.request("x", {});
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 99, result: 1 }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "first" }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "second" }));
    expect(await p).toBe("first");
  });

  it("settles an answer only after the notifications that came before it were handled", async () => {
    const order: string[] = [];
    const r = rig(undefined, vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("last reply slice filed");
    }));
    const prompt = r.client.request("session/prompt", {}).then((result) => void order.push(`answered ${JSON.stringify(result)}`));
    r.client.receive('{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Executed the echo command."}}}}');
    r.client.receive('{"jsonrpc":"2.0","result":{"stopReason":"end_turn"},"id":1}');
    await tick();
    expect(order).toEqual([]);
    await prompt;
    expect(order).toEqual(["last reply slice filed", 'answered {"stopReason":"end_turn"}']);
  });

  it("rejects at once after the client closed, without writing", async () => {
    const r = rig();
    r.client.close();
    await expect(r.client.request("x", {})).rejects.toThrow("The agent's process ended.");
    expect(r.write).not.toHaveBeenCalled();
  });
});

describe("AcpClient.notify", () => {
  it("writes a notification with no id, and nothing once closed", () => {
    const r = rig();
    r.client.notify("session/cancel", { sessionId: "S" });
    expect(r.sent()).toEqual([{ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "S" } }]);
    r.client.close();
    r.client.notify("session/cancel", { sessionId: "S" });
    expect(r.write).toHaveBeenCalledTimes(1);
  });
});

describe("AcpClient.close", () => {
  it("fails every waiting request with the first error it closed with", async () => {
    const r = rig();
    const a = r.client.request("a", {});
    const b = r.client.request("b", {});
    r.client.close(new Error("gone"));
    r.client.close(new Error("later"));
    await expect(a).rejects.toThrow("gone");
    await expect(b).rejects.toThrow("gone");
    await expect(r.client.request("c", {})).rejects.toThrow("gone");
  });

  it("closes when a write throws, failing the request that wrote", async () => {
    const client = new AcpClient(() => {
      throw new Error("EPIPE");
    }, vi.fn(), vi.fn());
    await expect(client.request("a", {})).rejects.toThrow("EPIPE");
    await expect(client.request("b", {})).rejects.toThrow("EPIPE");
  });

  it("wraps a write that throws something other than an Error", async () => {
    const client = new AcpClient(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- what's under test: a throw that isn't an Error
      throw "broken pipe";
    }, vi.fn(), vi.fn());
    const err = await client.request("a", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AcpError);
    expect((err as Error).message).toBe("broken pipe");
  });
});

describe("AcpClient.receive", () => {
  it("skips blank lines, lines that aren't JSON, JSON that isn't an object, and messages with neither method nor id", async () => {
    const r = rig();
    for (const line of ["", "   ", "not json", "{bad", "null", "5", '"text"', JSON.stringify({ jsonrpc: "2.0" })]) r.client.receive(line);
    await tick();
    expect(r.onRequest).not.toHaveBeenCalled();
    expect(r.onNotification).not.toHaveBeenCalled();
    expect(r.write).not.toHaveBeenCalled();
  });

  it("handles notifications one at a time, in the order they came, even when an earlier one is slower", async () => {
    const order: string[] = [];
    const r = rig(undefined, vi.fn(async (method: string, params: unknown) => {
      order.push(`start ${(params as { n: number }).n}`);
      if ((params as { n: number }).n === 1) await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end ${(params as { n: number }).n}`);
    }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { n: 1 } }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { n: 2 } }));
    await vi.waitFor(() => expect(order).toHaveLength(4));
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
    expect(r.onNotification).toHaveBeenCalledWith("session/update", { n: 1 });
  });

  it("logs a notification handler that fails and goes on with the next", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    const r = rig(undefined, vi.fn((_m: string, params: unknown) => {
      const n = (params as { n: number }).n;
      if (n === 1) throw new Error("bad update");
      seen.push(n);
    }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", method: "u", params: { n: 1 } }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", method: "u", params: { n: 2 } }));
    await vi.waitFor(() => expect(seen).toEqual([2]));
    expect(error).toHaveBeenCalledWith("[acp] notification failed:", expect.objectContaining({ message: "bad update" }));
  });

  it("answers the agent's request with the handler's result, keeping its id (a string or a number)", async () => {
    const r = rig(vi.fn((method: string) => Promise.resolve(method === "session/request_permission" ? { outcome: { outcome: "selected", optionId: "allow" } } : undefined)));
    r.client.receive('{"jsonrpc":"2.0","method":"session/request_permission","params":{"sessionId":"S","toolCall":{"toolCallId":"call_1","name":"run_command","rawInput":{"CommandLine":"echo hello_weft"},"title":"echo hello_weft"},"options":[{"optionId":"allow","name":"Allow","kind":"allow_once"},{"optionId":"deny","name":"Deny","kind":"reject_once"}]},"id":"1"}');
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "fs/whatever", params: {} }));
    await vi.waitFor(() => expect(r.write).toHaveBeenCalledTimes(2));
    expect(r.onRequest.mock.calls[0]?.[0]).toBe("session/request_permission");
    expect(r.onRequest.mock.calls[0]?.[1]).toMatchObject({ sessionId: "S", toolCall: { toolCallId: "call_1" } });
    expect(r.sent()).toEqual([
      { jsonrpc: "2.0", id: "1", result: { outcome: { outcome: "selected", optionId: "allow" } } },
      // A handler that returns nothing still answers: JSON-RPC needs a result.
      { jsonrpc: "2.0", id: 7, result: null },
    ]);
  });

  it("answers with a JSON-RPC error when the handler throws an Error or anything else", async () => {
    const r = rig(vi.fn().mockRejectedValueOnce(new Error("Weft doesn't answer fs/read.")).mockRejectedValueOnce("nope"));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "fs/read", params: {} }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "fs/write", params: {} }));
    await vi.waitFor(() => expect(r.write).toHaveBeenCalledTimes(2));
    expect(r.sent()).toEqual([
      { jsonrpc: "2.0", id: 1, error: { code: -32603, message: "Weft doesn't answer fs/read." } },
      { jsonrpc: "2.0", id: 2, error: { code: -32603, message: "nope" } },
    ]);
  });

  it("starts a request handler only after the notifications before it, but doesn't hold later ones behind it", async () => {
    const order: string[] = [];
    let release!: () => void;
    const onRequest = vi.fn(() => {
      order.push("request");
      return new Promise<unknown>((resolve) => (release = () => resolve("ok")));
    });
    const onNotification = vi.fn(async (_m: string, params: unknown) => {
      const n = (params as { n: number }).n;
      if (n === 1) await new Promise((resolve) => setTimeout(resolve, 15));
      order.push(`update ${n}`);
    });
    const r = rig(onRequest, onNotification);
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { n: 1 } }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", id: "p", method: "session/request_permission", params: {} }));
    r.client.receive(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { n: 2 } }));
    await vi.waitFor(() => expect(order).toEqual(["update 1", "request", "update 2"]));
    expect(r.write).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(r.sent()).toEqual([{ jsonrpc: "2.0", id: "p", result: "ok" }]));
  });
});

describe("AcpClient.listen", () => {
  it("reads lines from the stream until it ends, then fails what's still waiting with why()", async () => {
    const r = rig();
    const stdout = new PassThrough();
    const listening = r.client.listen(stdout, () => "agy: logged out");
    const answered = r.client.request("initialize", {});
    const pending = r.client.request("session/prompt", {});
    stdout.write('{"jsonrpc":"2.0","result":{"protocolVersion":1},"id":1}\r\n');
    stdout.write("noise from agy\n");
    stdout.end('{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"S","update":{"sessionUpdate":"usage_update","used":15082,"size":1048576}}}');
    await listening;
    expect(await answered).toEqual({ protocolVersion: 1 });
    await expect(pending).rejects.toThrow("agy: logged out");
    expect(r.onNotification).toHaveBeenCalledWith("session/update", expect.objectContaining({ sessionId: "S" }));
  });

  it("waits for the notifications already started before it closes, and says the process ended by default", async () => {
    const done: string[] = [];
    const r = rig(undefined, vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      done.push("update");
    }));
    const stdout = new PassThrough();
    const pending = r.client.request("session/prompt", {});
    const listening = r.client.listen(stdout);
    stdout.end('{"jsonrpc":"2.0","method":"session/update","params":{}}\n');
    await listening;
    expect(done).toEqual(["update"]);
    await expect(pending).rejects.toThrow("The agent's process ended.");
  });
});

it("lists its code for the runner's build fingerprint", () => {
  expect(ACP_CLIENT_CODE).toEqual([AcpClient]);
});
