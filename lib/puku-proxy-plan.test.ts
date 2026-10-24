import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { proxy, type PlanMeter } from "./puku-proxy";
import { config, enc, fetchMock, memoryStore, ok, request, sse } from "./puku-proxy.harness";

// The Puku trial's "with a plan meter" cases (lib/puku-proxy.ts, lib/puku-proxy.test.ts's parent describe):
// a Pro workspace's allowance bypasses the daily cap and tokens are billed to the workspace at the end of
// the request; a missing or throwing meter keeps the Free path on.

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// vitest 4 narrows `vi.fn()` to `Mock<Procedure | Constructable>`, which no longer matches a typed
// PlanMeter method. The runtime mock is fine; a permissive `Mock<any[], any>` is what the tests
// need. Each test keeps the meter's check/record in their own const so the `unbound-method` rule
// doesn't fire when the test asserts on them, and drops `async` from the body where there's no
// `await` (`require-await`). The alias is the one place we mean `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFn = Mock<(...args: any[]) => any>;
type Plan = { check: MockFn; record: MockFn };

function approvedPlan(remaining = 1_000_000): Plan {
  const check = vi.fn<(userId: string) => Promise<{ orgId: string; remaining: number }>>(() => Promise.resolve({ orgId: "org-1", remaining }));
  const record = vi.fn<(orgId: string, userId: string, tokens: number) => Promise<void>>(() => Promise.resolve());
  return { check, record };
}

describe("with a plan meter", () => {
  it("bypasses the daily cap for a Pro user with tokens left", async () => {
    const store = memoryStore({ requests: 999 });
    const { check, record } = approvedPlan();
    fetchMock.mockResolvedValue(ok("{}"));
    const res = await proxy(await request("messages"), "messages", config({ store, plan: { check, record } }));
    expect(res.status).toBe(200);
    // The daily counter still gets a row, so per-day stats stay accurate.
    expect(store.add).toHaveBeenCalledWith("u1", "2026-10-13", expect.objectContaining({ requests: 1 }));
    expect(check).toHaveBeenCalledWith("u1");
    expect(record).not.toHaveBeenCalled();
  });

  it("returns 429 when the Pro workspace's allowance is exhausted", async () => {
    const check = vi.fn<(userId: string) => Promise<{ orgId: string; remaining: number }>>(() => Promise.resolve({ orgId: "org-1", remaining: 0 }));
    const record = vi.fn();
    const plan: PlanMeter = { check, record };
    const store = memoryStore();
    const res = await proxy(await request("messages"), "messages", config({ store, plan }));
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Pro Puku allowance/i);
    expect(store.add).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when what's left can't cover what the request could cost", async () => {
    const store = memoryStore();
    const { check, record } = approvedPlan(150);
    const res = await proxy(await request("messages", { body: JSON.stringify({ max_tokens: 200 }) }), "messages", config({ store, plan: { check, record } }));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/doesn't have enough left/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("charges the workspace for a reply the client cut short, and holds nothing in the day's row", async () => {
    const events = sse([{ type: "message_start", message: { usage: { input_tokens: 30 } } }, { type: "content_block_delta", delta: { text: "x".repeat(80) } }]);
    fetchMock.mockResolvedValue(ok(new ReadableStream({ start: (c) => c.enqueue(enc.encode(events)) }), { "content-type": "text/event-stream" }));
    const store = memoryStore();
    const { check, record } = approvedPlan();
    const res = await proxy(await request("messages", { body: '{"max_tokens":500}' }), "messages", config({ store, plan: { check, record } }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(store.add).toHaveBeenNthCalledWith(1, "u1", "2026-10-13", expect.objectContaining({ requests: 1, input_tokens: 0, output_tokens: 0 }));
    expect(record).toHaveBeenCalledWith("org-1", "u1", 30 + 20);
  });

  it("charges a JSON reply cut short at its estimate and its full max_tokens", async () => {
    fetchMock.mockResolvedValue(ok(new ReadableStream({ start: (c) => c.enqueue(enc.encode('{"content":')) })));
    const { check, record } = approvedPlan();
    const res = await proxy(await request("messages", { body: JSON.stringify({ max_tokens: 500, system: "y".repeat(400) }) }), "messages", config({ plan: { check, record } }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(record).toHaveBeenCalledWith("org-1", "u1", 100 + 500);
  });

  it("keeps the daily cap when the meter says no allowance (Free or unmetered plan)", async () => {
    const check = vi.fn<(userId: string) => Promise<{ orgId: string; remaining: number } | null>>(() => Promise.resolve(null));
    const record = vi.fn();
    const plan: PlanMeter = { check, record };
    const store = memoryStore({ requests: 301 });
    const res = await proxy(await request("messages"), "messages", config({ store, plan }));
    expect(res.status).toBe(429);
    const errBody = (await res.json()) as { error: { message: string } };
    expect(errBody.error.message).toMatch(/free Puku trial/i);
    expect(check).toHaveBeenCalledWith("u1");
  });

  it("falls back to the Free path when the meter check throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const check = vi.fn<(userId: string) => Promise<{ orgId: string; remaining: number }>>(() => {
      throw new Error("billing down");
    });
    const record = vi.fn();
    const plan: PlanMeter = { check, record };
    const store = memoryStore({ requests: 1, input_tokens: 10, output_tokens: 10 });
    fetchMock.mockResolvedValue(ok("{}"));
    const res = await proxy(await request("messages"), "messages", config({ store, plan, dailyTokens: 100 }));
    expect(res.status).toBe(200);
    expect(err).toHaveBeenCalledWith("Puku trial: plan meter check failed: billing down");
    expect(record).not.toHaveBeenCalled();
  });

  it("records input + output tokens against the workspace after a successful reply", async () => {
    const body = sse([
      { type: "message_start", message: { usage: { input_tokens: 12, cache_read_input_tokens: 3 } } },
      { type: "message_delta", usage: { output_tokens: 20 } },
    ]);
    fetchMock.mockResolvedValue(ok(body, { "content-type": "text/event-stream; charset=utf-8" }));
    const store = memoryStore();
    const { check, record } = approvedPlan();
    const res = await proxy(await request("messages"), "messages", config({ store, plan: { check, record } }));
    expect(await res.text()).toBe(body);
    expect(record).toHaveBeenCalledWith("org-1", "u1", 32);
  });

  it("doesn't count cache reads in the metered amount", async () => {
    const body = sse([{ type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 100 } } }]);
    fetchMock.mockResolvedValue(ok(body, { "content-type": "text/event-stream; charset=utf-8" }));
    const store = memoryStore();
    const { check, record } = approvedPlan();
    await (await proxy(await request("messages"), "messages", config({ store, plan: { check, record } }))).text();
    expect(record).toHaveBeenCalledWith("org-1", "u1", 5);
  });

  it("logs a record failure but still streams the body", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = sse([{ type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 5 } } }]);
    fetchMock.mockResolvedValue(ok(body, { "content-type": "text/event-stream; charset=utf-8" }));
    const store = memoryStore();
    const check = vi.fn<(userId: string) => Promise<{ orgId: string; remaining: number }>>(() => Promise.resolve({ orgId: "org-1", remaining: 1_000_000 }));
    const record = vi.fn<(orgId: string, userId: string, tokens: number) => Promise<void>>(() => {
      throw new Error("ledger down");
    });
    const plan: PlanMeter = { check, record };
    const res = await proxy(await request("messages"), "messages", config({ store, plan }));
    expect(await res.text()).toBe(body);
    expect(err).toHaveBeenCalledWith("Puku trial: plan meter record failed: ledger down");
  });

  it("doesn't record on a model-list request", async () => {
    fetchMock.mockResolvedValue(ok('{"data":[]}'));
    const store = memoryStore();
    const { check, record } = approvedPlan();
    await proxy(await request("models", { method: "GET", body: undefined }), "models", config({ store, plan: { check, record } }));
    expect(check).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
