import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, mergeUsage, overCap, proxy, restUsageStore, today, trialToken, usageIn, type Usage } from "./puku-proxy";
import { DEFAULT_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS } from "./puku-proxy-usage";
import { signTrialToken } from "./puku-trial-token";
import { config, enc, fetchMock, memoryStore, NOW, ok, request, SECRET, sse } from "./puku-proxy.harness";

// The Puku trial's proxy: auth, caps, header hygiene, usage metering from SSE and JSON replies, and the REST usage store.
// The "with a plan meter" cases live in lib/puku-proxy-plan.test.ts to keep this file under max-lines.

const ZERO: Usage = { requests: 0, input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("small helpers", () => {
  it("apiError uses the Messages API's shape", async () => {
    const res = apiError(429, "rate_limit_error", "slow down");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ type: "error", error: { type: "rate_limit_error", message: "slow down" } });
  });

  it("trialToken prefers x-api-key, then Bearer, then nothing", () => {
    const mk = (h: Record<string, string>) => new Request("https://x/y", { headers: h });
    expect(trialToken(mk({ "x-api-key": " a ", authorization: "Bearer b" }))).toBe("a");
    expect(trialToken(mk({ authorization: "Bearer  b " }))).toBe("b");
    expect(trialToken(mk({ authorization: "Basic b" }))).toBe("");
    expect(trialToken(mk({}))).toBe("");
  });

  it("overCap trips on requests past the limit or tokens at it", () => {
    expect(overCap({ ...ZERO, requests: 5 }, 5, 100)).toBe(false);
    expect(overCap({ ...ZERO, requests: 6 }, 5, 100)).toBe(true);
    expect(overCap({ ...ZERO, input_tokens: 60, output_tokens: 39 }, 5, 100)).toBe(false);
    expect(overCap({ ...ZERO, input_tokens: 60, output_tokens: 40 }, 5, 100)).toBe(true);
  });

  it("today is the UTC date", () => expect(today(NOW)).toBe("2026-10-13"));

  it("mergeUsage keeps the larger counts and ignores junk", () => {
    expect(mergeUsage(ZERO, undefined)).toBe(ZERO);
    expect(mergeUsage(ZERO, "x" as never)).toBe(ZERO);
    const a = mergeUsage(ZERO, { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 7, output_tokens: 1 });
    expect(a).toEqual({ requests: 0, input_tokens: 15, cache_read_tokens: 7, output_tokens: 1 });
    expect(mergeUsage(a, { output_tokens: 9, input_tokens: -3, cache_read_input_tokens: Infinity })).toEqual({ ...a, output_tokens: 9 });
    expect(mergeUsage(a, { output_tokens: 3 }).output_tokens).toBe(3);
  });

  it("usageIn reads message.usage and usage, and survives bad JSON", () => {
    expect(usageIn(JSON.stringify({ message: { usage: { input_tokens: 4 } }, usage: { output_tokens: 2 } }), ZERO)).toMatchObject({ input_tokens: 4, output_tokens: 2 });
    expect(usageIn("{}", ZERO)).toEqual(ZERO);
    expect(usageIn("[DONE", ZERO)).toBe(ZERO);
  });
});

describe("proxy", () => {
  it("answers only POST and GET", async () => {
    const res = await proxy(await request("messages", { method: "DELETE", body: undefined }), "messages", config());
    expect(res.status).toBe(405);
  });

  it("serves only puku-cli's paths", async () => {
    expect((await proxy(await request("admin"), "admin", config())).status).toBe(404);
    expect((await proxy(await request("messages/evil"), "messages/evil", config())).status).toBe(404);
  });

  it("rejects a missing or bad token", async () => {
    expect((await proxy(await request("messages", { token: "wpt1.x.y" }), "messages", config())).status).toBe(401);
    const expired = (await signTrialToken("u1", SECRET, NOW - 2 * 86_400_000)).token;
    expect((await proxy(await request("messages", { token: expired }), "messages", config())).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts a messages request and answers 429 over the request cap", async () => {
    const store = memoryStore({ requests: 301 });
    const res = await proxy(await request("messages"), "messages", config({ store }));
    expect(res.status).toBe(429);
    // The request and what it could cost go in at once, and the hold comes back with the refusal.
    expect(store.add).toHaveBeenNthCalledWith(1, "u1", "2026-10-13", { ...ZERO, requests: 1, output_tokens: DEFAULT_OUTPUT_TOKENS });
    expect(store.add).toHaveBeenNthCalledWith(2, "u1", "2026-10-13", { ...ZERO, output_tokens: -DEFAULT_OUTPUT_TOKENS });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 429 over the token cap, with custom limits", async () => {
    const store = memoryStore({ requests: 1, input_tokens: 90, output_tokens: 10 });
    const res = await proxy(await request("messages"), "messages", config({ store, dailyTokens: 100 }));
    expect(res.status).toBe(429);
    const store2 = memoryStore({ requests: 3 });
    expect((await proxy(await request("messages"), "messages", config({ store: store2, dailyRequests: 2 }))).status).toBe(429);
  });

  it("doesn't count the model list", async () => {
    fetchMock.mockResolvedValue(ok('{"data":[]}'));
    const store = memoryStore();
    const res = await proxy(await request("models", { method: "GET", body: undefined }), "models", config({ store }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"data":[]}');
    expect(store.add).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api-cli.puku.sh/v1/models");
    expect(init?.body).toBeUndefined();
  });

  it("answers 502 when Puku can't be reached", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const res = await proxy(await request("messages"), "messages", config());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("ECONNRESET");
  });

  it("refuses a request asking for more output than the cap, before counting it", async () => {
    const store = memoryStore();
    const res = await proxy(await request("messages", { body: JSON.stringify({ max_tokens: MAX_OUTPUT_TOKENS + 1 }) }), "messages", config({ store }));
    expect(res.status).toBe(400);
    expect(store.add).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses counting tokens over the cap with nothing to give back", async () => {
    const store = memoryStore({ requests: 301 });
    expect((await proxy(await request("messages/count_tokens"), "messages/count_tokens", config({ store }))).status).toBe(429);
    expect(store.add).toHaveBeenCalledTimes(1);
  });

  it("doesn't hold anything for counting tokens", async () => {
    fetchMock.mockResolvedValue(ok("{}"));
    const store = memoryStore();
    await (await proxy(await request("messages/count_tokens"), "messages/count_tokens", config({ store }))).text();
    expect(store.add).toHaveBeenCalledExactlyOnceWith("u1", "2026-10-13", { ...ZERO, requests: 1 });
  });

  it("passes an upstream error through and gives the hold back", async () => {
    fetchMock.mockResolvedValue(ok('{"error":"bad"}', { "content-type": "application/json" }, 400));
    const store = memoryStore();
    const res = await proxy(await request("messages"), "messages", config({ store }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('{"error":"bad"}');
    expect(store.add).toHaveBeenLastCalledWith("u1", "2026-10-13", { ...ZERO, output_tokens: -DEFAULT_OUTPUT_TOKENS });
  });

  it("passes a body-less upstream reply through", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await proxy(await request("messages"), "messages", config());
    expect(res.status).toBe(204);
  });

  it("streams a success back untouched, then trades the hold for its usage", async () => {
    const body = sse([
      { type: "message_start", message: { usage: { input_tokens: 12, cache_read_input_tokens: 3 } } },
      { type: "message_delta", usage: { output_tokens: 20 } },
    ]);
    fetchMock.mockResolvedValue(ok(body, { "content-type": "text/event-stream; charset=utf-8" }));
    const store = memoryStore();
    const res = await proxy(await request("messages", { body: '{"max_tokens":100}' }), "messages", config({ store }));
    expect(await res.text()).toBe(body);
    expect(store.add).toHaveBeenNthCalledWith(1, "u1", "2026-10-13", { ...ZERO, requests: 1, input_tokens: 0, output_tokens: 100 });
    expect(store.add).toHaveBeenLastCalledWith("u1", "2026-10-13", { requests: 0, input_tokens: 12, cache_read_tokens: 3, output_tokens: 20 - 100 });
  });

  it("charges a client that hangs up before the reply ends", async () => {
    const events = sse([{ type: "message_start", message: { usage: { input_tokens: 12 } } }, { type: "content_block_delta", delta: { text: "x".repeat(400) } }]);
    fetchMock.mockResolvedValue(ok(new ReadableStream({ start: (c) => c.enqueue(enc.encode(events)) }), { "content-type": "text/event-stream" }));
    const store = memoryStore();
    const tasks: Promise<void>[] = [];
    const res = await proxy(await request("messages", { body: '{"max_tokens":1000}' }), "messages", config({ store, background: (t) => tasks.push(t) }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await Promise.all(tasks);
    expect(store.add).toHaveBeenLastCalledWith("u1", "2026-10-13", { requests: 0, input_tokens: 12, cache_read_tokens: 0, output_tokens: 100 - 1000 });
  });

  it("meters a non-streaming JSON reply", async () => {
    fetchMock.mockResolvedValue(ok(JSON.stringify({ usage: { input_tokens: 5, output_tokens: 6 } })));
    const store = memoryStore();
    await (await proxy(await request("messages/count_tokens"), "messages/count_tokens", config({ store }))).text();
    expect(store.add).toHaveBeenLastCalledWith("u1", "2026-10-13", expect.objectContaining({ input_tokens: 5, output_tokens: 6 }));
  });

  it("treats a reply with no content-type as non-streaming", async () => {
    fetchMock.mockResolvedValue(new Response(enc.encode('{"usage":{"output_tokens":4}}')));
    const store = memoryStore();
    await (await proxy(await request("messages"), "messages", config({ store }))).text();
    expect(store.add).toHaveBeenLastCalledWith("u1", "2026-10-13", expect.objectContaining({ output_tokens: 4 - DEFAULT_OUTPUT_TOKENS }));
  });

  it("doesn't record zero usage", async () => {
    fetchMock.mockResolvedValue(ok("{}"));
    const store = memoryStore();
    await (await proxy(await request("messages/count_tokens"), "messages/count_tokens", config({ store }))).text();
    expect(store.add).toHaveBeenCalledTimes(1);
  });

  it("swaps in Weft's key, drops hop headers and keeps the rest, plus the query string", async () => {
    fetchMock.mockResolvedValue(
      ok("{}", { "content-type": "application/json", "content-encoding": "gzip", "content-length": "99", "transfer-encoding": "chunked", "x-request-id": "r1" }),
    );
    const req = await request("messages?beta=true", {
      headers: {
        authorization: "Bearer trial",
        host: "weft.example",
        cookie: "a=b",
        "x-forwarded-for": "1.2.3.4",
        "x-vercel-id": "v",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: '{"model":"m"}',
    });
    const res = await proxy(req, "messages", config({ upstream: "https://up.example" }));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://up.example/v1/messages?beta=true");
    const sent = new Headers(init?.headers);
    expect(sent.get("x-api-key")).toBe("real-key");
    expect(sent.has("authorization")).toBe(false);
    expect(sent.get("anthropic-version")).toBe("2023-06-01");
    for (const h of ["host", "cookie", "x-forwarded-for", "x-vercel-id"]) expect(sent.has(h)).toBe(false);
    expect(Buffer.from(init?.body as ArrayBuffer).toString()).toBe('{"model":"m"}');
    expect(res.headers.get("x-request-id")).toBe("r1");
    for (const h of ["content-encoding", "content-length", "transfer-encoding"]) expect(res.headers.has(h)).toBe(false);
  });

  it("uses the real clock by default", async () => {
    fetchMock.mockResolvedValue(ok("{}"));
    const token = (await signTrialToken("u1", SECRET)).token;
    const res = await proxy(await request("models", { token, method: "GET", body: undefined }), "models", { apiKey: "k", secret: SECRET, store: memoryStore() });
    expect(res.status).toBe(200);
  });
});

describe("restUsageStore", () => {
  const usage: Usage = { requests: 1, input_tokens: 2, cache_read_tokens: 3, output_tokens: 4 };

  it("calls puku_trial_add and parses the row, with a new-style key in apikey alone", async () => {
    fetchMock.mockResolvedValue(Response.json({ requests: 5, input_tokens: "x", cache_read_tokens: 7, output_tokens: -1 }));
    const total = await restUsageStore("https://x.supabase.co", "sb_secret_abc").add("u1", "2026-10-13", usage);
    expect(total).toEqual({ requests: 5, input_tokens: 0, cache_read_tokens: 7, output_tokens: 0 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/puku_trial_add");
    expect(init?.headers).toEqual({ apikey: "sb_secret_abc", "content-type": "application/json" });
    expect(JSON.parse(init?.body as string)).toEqual({ p_user: "u1", p_day: "2026-10-13", p_requests: 1, p_input: 2, p_cache_read: 3, p_output: 4 });
  });

  it("sends a legacy JWT as the bearer too", async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await restUsageStore("https://x", "eyJ.jwt").add("u", "d", usage);
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({ apikey: "eyJ.jwt", authorization: "Bearer eyJ.jwt" });
  });

  it("throws on a non-ok answer", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(restUsageStore("https://x", "sb_k").add("u", "d", usage)).rejects.toThrow("Supabase 500: boom");
  });
});