import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOBAL_DAILY_REQUESTS, GLOBAL_DAILY_TOKENS, proxy, restUsageStore, type Usage, type UsageStore } from "./puku-proxy";
import { DEFAULT_OUTPUT_TOKENS } from "./puku-proxy-usage";
import { config, fetchMock, ok, request, ZERO } from "./puku-proxy.harness";

// The whole Puku trial's daily cap across every account (lib/puku-proxy.ts addGlobal, docs/architecture/puku-trial.md):
// free accounts are free to open, so one person with many of them still meets this ceiling.

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A store whose first add for the account and for everyone answer the given totals, and zero after.
function store(mine: Partial<Usage> = { requests: 1 }, everyone: Partial<Usage> = { requests: 1 }) {
  const add = vi.fn<UsageStore["add"]>().mockResolvedValueOnce({ ...ZERO, ...mine }).mockResolvedValue(ZERO);
  const addGlobal = vi.fn<NonNullable<UsageStore["addGlobal"]>>().mockResolvedValueOnce({ ...ZERO, ...everyone }).mockResolvedValue(ZERO);
  return { add, addGlobal };
}

const held = { ...ZERO, requests: 1, output_tokens: DEFAULT_OUTPUT_TOKENS };
const message = async (res: Response) => ((await res.json()) as { error: { message: string } }).error.message;

describe("the global daily cap", () => {
  it("counts a free request in the whole trial's row too, and settles both rows with what it spent", async () => {
    const s = store();
    fetchMock.mockResolvedValue(ok(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } })));
    const res = await proxy(await request("messages"), "messages", config({ store: s }));
    expect(res.status).toBe(200);
    await res.text();
    await vi.waitFor(() => expect(s.addGlobal).toHaveBeenCalledTimes(2));
    expect(s.addGlobal).toHaveBeenNthCalledWith(1, "2026-10-13", held);
    // Settling trades the hold for what was spent, in the same change for both rows.
    expect(s.addGlobal.mock.calls[1]).toEqual(["2026-10-13", s.add.mock.calls[1]![2]]);
    expect(s.addGlobal.mock.calls[1]![1]).toMatchObject({ input_tokens: 10, output_tokens: 5 - DEFAULT_OUTPUT_TOKENS });
  });

  it("answers 429 for everyone once the whole trial passes its requests or tokens, and gives the hold back", async () => {
    const s = store({ requests: 1 }, { requests: GLOBAL_DAILY_REQUESTS + 1 });
    const res = await proxy(await request("messages"), "messages", config({ store: s }));
    expect(res.status).toBe(429);
    expect(await message(res)).toMatch(/^Weft's free Puku trial is used up for today, across everyone\. Log in to Puku/);
    expect(fetchMock).not.toHaveBeenCalled();
    const back = { ...ZERO, output_tokens: -DEFAULT_OUTPUT_TOKENS };
    expect(s.add).toHaveBeenNthCalledWith(2, "u1", "2026-10-13", back);
    expect(s.addGlobal).toHaveBeenNthCalledWith(2, "2026-10-13", back);

    const t = store({ requests: 1 }, { requests: 1, input_tokens: GLOBAL_DAILY_TOKENS });
    expect((await proxy(await request("messages"), "messages", config({ store: t }))).status).toBe(429);
  });

  it("takes its caps from the config", async () => {
    const s = store({ requests: 1 }, { requests: 6 });
    expect((await proxy(await request("messages"), "messages", config({ store: s, globalDailyRequests: 5 }))).status).toBe(429);
  });

  it("names the account's own cap first when both are over", async () => {
    const s = store({ requests: 999 }, { requests: GLOBAL_DAILY_REQUESTS + 1 });
    const res = await proxy(await request("messages"), "messages", config({ store: s }));
    expect(await message(res)).toMatch(/^You've used today's free Puku trial in Weft\./);
  });

  it("leaves a Pro workspace's requests out of the whole trial's row", async () => {
    const s = store();
    const check = vi.fn(() => Promise.resolve({ orgId: "org-1", remaining: 1_000_000 }));
    const record = vi.fn(() => Promise.resolve());
    fetchMock.mockResolvedValue(ok(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 } })));
    const res = await proxy(await request("messages"), "messages", config({ store: s, plan: { check, record } }));
    await res.text();
    await vi.waitFor(() => expect(record).toHaveBeenCalled());
    expect(s.addGlobal).not.toHaveBeenCalled();
  });

  it("goes without the global cap, and says so, when its row can't be reached", async () => {
    const s = store();
    s.addGlobal.mockReset().mockRejectedValue(new Error("Supabase 404: function not found"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(ok("{}"));
    const res = await proxy(await request("messages"), "messages", config({ store: s }));
    expect(res.status).toBe(200);
    expect(log).toHaveBeenCalledWith("Puku trial: global usage add failed: Supabase 404: function not found");
  });

  it("restUsageStore adds to it through puku_trial_global_add", async () => {
    fetchMock.mockResolvedValue(Response.json({ day: "2026-10-13", requests: 7, input_tokens: 1, cache_read_tokens: 2, output_tokens: 3 }));
    const total = await restUsageStore("https://x.supabase.co", "sb_secret_abc").addGlobal!("2026-10-13", { requests: 1, input_tokens: 2, cache_read_tokens: 3, output_tokens: 4 });
    expect(total).toEqual({ requests: 7, input_tokens: 1, cache_read_tokens: 2, output_tokens: 3 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/puku_trial_global_add");
    expect(JSON.parse(init?.body as string)).toEqual({ p_day: "2026-10-13", p_requests: 1, p_input: 2, p_cache_read: 3, p_output: 4 });
  });
});
