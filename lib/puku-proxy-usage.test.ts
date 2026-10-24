import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS, metered, reserve, type Usage } from "./puku-proxy-usage";
import { enc, sse } from "./puku-proxy.harness";

// What a Puku request costs: the reservation taken before it goes out, and the meter that reports a reply's usage
// once however it ends (lib/puku-proxy-usage.ts). The proxy's own cases are lib/puku-proxy.test.ts.

afterEach(() => vi.restoreAllMocks());

const json = (value: unknown) => enc.encode(JSON.stringify(value)).buffer;

describe("reserve", () => {
  it("sets aside the text's tokens and the asked-for output", () => {
    expect(reserve(json({ max_tokens: 100, system: "x".repeat(40), messages: [{ role: "user", content: [{ type: "text", text: "y".repeat(8) }] }] }))).toEqual({
      input: Math.ceil((40 + 4 + 4 + 8) / 4), // the strings: system, "user", the block's "text" type and its text
      output: 100,
    });
  });

  it("counts an image or document as a flat 1,600 tokens, not by its base64", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(400_000) } };
    expect(reserve(json({ max_tokens: 10, messages: [{ content: [image] }] }))).toEqual({ input: Math.ceil((5 + 6400) / 4), output: 10 });
  });

  it("falls back to the default output when max_tokens is missing or junk, and rounds a fraction up", () => {
    expect(reserve(json({}))).toEqual({ input: 0, output: DEFAULT_OUTPUT_TOKENS });
    expect(reserve(json({ max_tokens: -5 }))).toMatchObject({ output: DEFAULT_OUTPUT_TOKENS });
    expect(reserve(json({ max_tokens: "lots" }))).toMatchObject({ output: DEFAULT_OUTPUT_TOKENS });
    expect(reserve(json(null))).toEqual({ input: 0, output: DEFAULT_OUTPUT_TOKENS });
    expect(reserve(json({ max_tokens: 9.2 }))).toMatchObject({ output: 10 });
  });

  it("refuses a request asking for more than the cap", () => {
    expect(reserve(json({ max_tokens: MAX_OUTPUT_TOKENS }))).toMatchObject({ output: MAX_OUTPUT_TOKENS });
    expect(reserve(json({ max_tokens: MAX_OUTPUT_TOKENS + 1 }))).toEqual({ refused: `Weft's Puku allows max_tokens up to ${MAX_OUTPUT_TOKENS}.` });
  });

  it("sets aside a body that isn't JSON by its size, and an empty one as nothing in", () => {
    expect(reserve(enc.encode("x".repeat(41)).buffer)).toEqual({ input: 11, output: DEFAULT_OUTPUT_TOKENS });
    expect(reserve(undefined)).toEqual({ input: 0, output: DEFAULT_OUTPUT_TOKENS });
  });

  it("walks a deeply nested body without overflowing", () => {
    const deep = "[".repeat(3000) + '"abcd"' + "]".repeat(3000);
    expect(reserve(enc.encode(deep).buffer)).toEqual({ input: 1, output: DEFAULT_OUTPUT_TOKENS });
  });
});

describe("metered", () => {
  const source = (chunks: string[], close = true) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(enc.encode(chunk));
        if (close) c.close();
      },
    });
  const doneMock = () => vi.fn<(usage: Usage, clean: boolean) => Promise<void>>(() => Promise.resolve());
  const start = { type: "message_start", message: { usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 1 } } };

  it("reads usage from SSE events split across chunk boundaries, passes the bytes through, and reports a clean end", async () => {
    const body = sse([start, { type: "message_delta", usage: { output_tokens: 42 } }]);
    const done = doneMock();
    const chunks = [body.slice(0, 30), body.slice(30, 95), body.slice(95)];
    expect(await new Response(metered(source(chunks), true, done)).text()).toBe(body);
    expect(done).toHaveBeenCalledExactlyOnceWith({ requests: 0, input_tokens: 15, cache_read_tokens: 100, output_tokens: 42 }, true);
  });

  it("reads a final data line with no trailing newline", async () => {
    const done = doneMock();
    await new Response(metered(source([`data: ${JSON.stringify({ usage: { output_tokens: 3 } })}`]), true, done)).text();
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ output_tokens: 3 }), true);
  });

  it("reads the whole body of a non-streaming reply", async () => {
    const done = doneMock();
    await new Response(metered(source(['{"usage":{"input_tokens":8,', '"output_tokens":2}}']), false, done)).text();
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 8, output_tokens: 2 }), true);
  });

  it("still reports when the client hangs up before the last event, counting the text it was sent", async () => {
    const deltas = sse([start, { type: "content_block_delta", delta: { text: "a".repeat(40) } }, { type: "content_block_delta", delta: { thinking: "b".repeat(20), partial_json: 7 } }]);
    const done = doneMock();
    const reader = metered(source([deltas], false), true, done).getReader();
    await reader.read();
    await reader.cancel();
    expect(done).toHaveBeenCalledExactlyOnceWith({ requests: 0, input_tokens: 15, cache_read_tokens: 100, output_tokens: 15 }, false);
  });

  it("keeps the larger of the counted output and the text estimate on an early end", async () => {
    const body = sse([{ type: "message_delta", usage: { output_tokens: 50 } }, { type: "content_block_delta", delta: { text: "abcd" } }]);
    const done = doneMock();
    const reader = metered(source([body], false), true, done).getReader();
    await reader.read();
    await reader.cancel();
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ output_tokens: 50 }), false);
  });

  it("reports once when the request aborts, and cancels the upstream", async () => {
    const cancelled = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({ start: (c) => c.enqueue(enc.encode(sse([start]))), cancel: cancelled });
    const abort = new AbortController();
    const done = doneMock();
    const reader = metered(upstream, true, done, { signal: abort.signal }).getReader();
    await reader.read();
    abort.abort();
    await reader.cancel();
    expect(done).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ input_tokens: 15 }), false);
    expect(cancelled).toHaveBeenCalled();
  });

  it("charges a client that reads the text and then sits on the socket, once the deadline passes", async () => {
    vi.useFakeTimers();
    try {
      const events = sse([start, { type: "content_block_delta", delta: { text: "z".repeat(80) } }]);
      const done = doneMock();
      const reader = metered(source([events], false), true, done, { deadlineMs: 1000 }).getReader();
      await reader.read();
      await vi.advanceTimersByTimeAsync(999);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ input_tokens: 15, output_tokens: 20 }), false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports at once for a request that has already aborted", () => {
    const abort = new AbortController();
    abort.abort();
    const done = doneMock();
    metered(source([]), true, done, { signal: abort.signal });
    expect(done).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("reports and passes the error on when the upstream breaks", async () => {
    let fail: (e: Error) => void = () => {};
    const upstream = new ReadableStream<Uint8Array>({
      start(c) {
        fail = (e) => c.error(e);
        c.enqueue(enc.encode(sse([start])));
      },
    });
    const done = doneMock();
    const reader = metered(upstream, true, done).getReader();
    await reader.read();
    fail(new Error("socket hang up"));
    await expect(reader.read()).rejects.toThrow("socket hang up");
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ input_tokens: 15 }), false);
  });

  it("holds the background task open until the usage is written", async () => {
    const tasks: Promise<void>[] = [];
    let written = false;
    const done = vi.fn(async () => {
      await Promise.resolve();
      written = true;
    });
    await new Response(metered(source(["{}"]), false, done, { background: (task) => tasks.push(task) })).text();
    expect(tasks).toHaveLength(1);
    await tasks[0];
    expect(written).toBe(true);
  });

  it("reads nothing from a data line that isn't an event, and shrugs off an upstream that won't cancel", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start: (c) => c.enqueue(enc.encode("data: null\ndata: 7\n\n")),
      cancel: () => Promise.reject(new Error("already gone")),
    });
    const done = doneMock();
    const reader = metered(upstream, true, done).getReader();
    await reader.read();
    await reader.cancel();
    expect(done).toHaveBeenCalledWith({ requests: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 }, false);
  });

  it("logs a failure to record instead of breaking the reply", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await new Response(metered(source(["ok"]), false, () => Promise.reject(new Error("db down")))).text()).toBe("ok");
    expect(err).toHaveBeenCalledWith("Puku trial: couldn't record usage: db down");
  });
});
