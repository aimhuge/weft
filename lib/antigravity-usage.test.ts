import { afterEach, describe, expect, it, vi } from "vitest";

// Antigravity's quota from `agy -p /usage --output-format json`, as the plan-limits strip's two windows.

const mocks = vi.hoisted(() => ({
  bin: vi.fn((): string | null => "/bin/agy"),
  run: vi.fn((): Promise<string> => Promise.resolve("")),
  record: vi.fn(),
}));
vi.mock("./antigravity-login", async (original) => ({ ...(await original<typeof import("./antigravity-login")>()), antigravityBin: mocks.bin }));
vi.mock("./cli-exec", () => ({ runCliText: mocks.run }));
vi.mock("./limit-history", () => ({ recordLimits: mocks.record }));

const { USAGE_TIMEOUT_MS, agyLimits, parseAgyBuckets, pollAntigravityUsage } = await import("./antigravity-usage");

afterEach(() => vi.clearAllMocks());

const RESET = "2026-12-01T05:43:53Z";
const RESET_S = Date.parse(RESET) / 1000;
const NOT_STARTED = "1970-01-01T00:00:00Z";

function usage(groups: unknown, status = "SUCCESS") {
  return `{"conversation_id":"","status":"${status}","command":{"name":"usage","data":{"groups":${JSON.stringify(groups)}}}}\n`;
}

// What agy printed for a free account (2026-11-24), trimmed.
const LIVE = usage([
  {
    name: "Gemini Models",
    buckets: [{ id: "gemini-weekly", name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: 0.9610080122947693, reset_time: RESET }],
  },
  {
    name: "Claude and GPT models",
    buckets: [
      { id: "3p-weekly", window: "weekly", remaining_fraction: 1, reset_time: NOT_STARTED },
      { id: "3p-5h", window: "5h", remaining_fraction: 1, reset_time: NOT_STARTED },
    ],
  },
]);

describe("parseAgyBuckets", () => {
  it("flattens every group's buckets, with used = 1 - remaining_fraction and 1970 as no reset", () => {
    expect(parseAgyBuckets(LIVE)).toEqual([
      { group: "Gemini Models", id: "gemini-weekly", window: "weekly", used: 4, resetsAt: RESET_S },
      { group: "Claude and GPT models", id: "3p-weekly", window: "weekly", used: 0 },
      { group: "Claude and GPT models", id: "3p-5h", window: "5h", used: 0 },
    ]);
  });

  it("skips what isn't a bucket, and keeps used between 0 and 100", () => {
    const out = usage([
      null,
      { buckets: "none" },
      { name: 3, buckets: [7, { id: "a", window: "5h" }, { id: "b", window: "5h", remaining_fraction: "1" }, { window: "5h", remaining_fraction: -0.5, reset_time: "soon" }, { id: "d", remaining_fraction: 1.5 }] },
    ]);
    expect(parseAgyBuckets(out)).toEqual([
      { group: "", id: "", window: "5h", used: 100 },
      { group: "", id: "d", window: "", used: 0 },
    ]);
  });

  it("is empty for a failure, an error or output with no groups", () => {
    expect(parseAgyBuckets(usage([], "ERROR"))).toEqual([]);
    expect(parseAgyBuckets('{"error":"authentication required"}')).toEqual([]);
    expect(parseAgyBuckets('{"status":"SUCCESS"}')).toEqual([]);
    expect(parseAgyBuckets("")).toEqual([]);
  });
});

describe("agyLimits", () => {
  it("takes the tightest bucket of each length across the groups", () => {
    expect(agyLimits(parseAgyBuckets(LIVE))).toEqual({ fiveHour: { used: 0 }, sevenDay: { used: 4, resetsAt: RESET_S } });
  });

  it("at a tie keeps a started window over one that hasn't, and the first of two started ones", () => {
    const b = (used: number, resetsAt?: number) => ({ group: "g", id: "x", window: "weekly", used, ...(resetsAt && { resetsAt }) });
    expect(agyLimits([b(0), b(0)])).toEqual({ sevenDay: { used: 0 } });
    expect(agyLimits([b(3), b(10)])).toEqual({ sevenDay: { used: 10 } });
    expect(agyLimits([b(0), b(0, 50)])).toEqual({ sevenDay: { used: 0, resetsAt: 50 } });
    expect(agyLimits([b(0, 50), b(0)])).toEqual({ sevenDay: { used: 0, resetsAt: 50 } });
    expect(agyLimits([b(10, 50), b(10, 60)])).toEqual({ sevenDay: { used: 10, resetsAt: 50 } });
    expect(agyLimits([b(10, 50), b(3, 60)])).toEqual({ sevenDay: { used: 10, resetsAt: 50 } });
  });

  it("ignores a window the strip has no place for", () => {
    expect(agyLimits([{ group: "g", id: "d", window: "daily", used: 50 }])).toEqual({});
  });
});

describe("pollAntigravityUsage", () => {
  it("runs `agy -p /usage` and records the reading under antigravity", async () => {
    mocks.run.mockResolvedValueOnce(LIVE);
    await expect(pollAntigravityUsage(1000)).resolves.toBe(true);
    expect(mocks.run).toHaveBeenCalledWith("/bin/agy", ["-p", "/usage", "--output-format", "json"], expect.objectContaining({ timeout: USAGE_TIMEOUT_MS }));
    expect(mocks.record).toHaveBeenCalledWith("antigravity", { fiveHour: { used: 0 }, sevenDay: { used: 4, resetsAt: RESET_S } }, 1000);
  });

  it("does nothing without agy, signed out, or with nothing readable", async () => {
    mocks.bin.mockReturnValueOnce(null);
    await expect(pollAntigravityUsage()).resolves.toBe(false);
    expect(mocks.run).not.toHaveBeenCalled();
    mocks.run.mockRejectedValueOnce(new Error("authentication required"));
    await expect(pollAntigravityUsage()).resolves.toBe(false);
    mocks.run.mockResolvedValueOnce(usage([]));
    await expect(pollAntigravityUsage()).resolves.toBe(false);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("takes its own steps when given them", async () => {
    const record = vi.fn();
    const ok = await pollAntigravityUsage(5, { bin: () => "agy", run: () => Promise.resolve(LIVE), record });
    expect(ok).toBe(true);
    expect(record).toHaveBeenCalledWith("antigravity", expect.objectContaining({ fiveHour: { used: 0 } }), 5);
  });
});
