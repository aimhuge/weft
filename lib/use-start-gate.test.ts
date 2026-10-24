// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The New thread dialog asks before it makes a card: a thread started on a model that has hit its
// limit comes straight back as a rate-limit error. This hook reads the numbers that decide it
// (lib/limit-reset.ts) off /api/limits/plans, so the button can say "Start at 2:30am".

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("./api-client", () => ({ apiFetch }));

const { GATE_POLL_MS, loadGates, resetGates, samplesOf, useStartGate, useThreadGate } = await import("./use-start-gate");

const NOW = Date.now();
const RESET_AT = NOW + 4 * 60 * 60 * 1000;

function plans(body: unknown, ok = true) {
  apiFetch.mockResolvedValue({ ok, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  resetGates();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve(null) });
});

afterEach(() => {
  resetGates();
});

describe("loadGates", () => {
  it("reads the plans and the spent models", async () => {
    plans({ plans: { claude: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, reportedAt: NOW } } });
    await loadGates();
    expect(apiFetch).toHaveBeenCalledWith("/api/limits/plans");
  });

  it("keeps the numbers it read", async () => {
    plans({ plans: { claude: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, reportedAt: NOW } }, models: [] });
    await loadGates();
    // The cached reading is what useStartGate answers from.
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("survives a failed read", async () => {
    plans(null, false);
    await expect(loadGates()).resolves.toBeUndefined();
  });

  it("survives a thrown read", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    await expect(loadGates()).resolves.toBeUndefined();
  });
});

describe("useStartGate", () => {
  it("has no answer while the numbers aren't in yet", () => {
    const { result } = renderHook(() => useStartGate("claude", "opus"));
    expect(result.current).toBeUndefined();
  });

  it("polls the plans again while a reader is there", () => {
    vi.useFakeTimers();
    renderHook(() => useStartGate("claude", "opus"));
    const reads = apiFetch.mock.calls.length;
    vi.advanceTimersByTime(GATE_POLL_MS);
    vi.useRealTimers();
    expect(apiFetch.mock.calls.length).toBe(reads + 1);
  });

  it("stops polling when the last reader goes away", () => {
    // Two readers, so the last one to leave is the one that empties the set.
    const a = renderHook(() => useStartGate("claude", "opus"));
    const b = renderHook(() => useThreadGate(undefined, undefined, "claude", "opus"));
    const reads = apiFetch.mock.calls.length;
    a.unmount();
    b.unmount();
    // The poll timer is cleared, so nothing keeps reading the plans.
    vi.useFakeTimers();
    vi.advanceTimersByTime(5 * 60 * 1000);
    vi.useRealTimers();
    expect(apiFetch.mock.calls.length).toBe(reads);
  });

  it("answers with the CLI's spent window", async () => {
    plans({ plans: { claude: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, reportedAt: NOW } } });
    await loadGates();
    const { result } = renderHook(() => useStartGate("claude", undefined));
    expect(result.current).toEqual({ at: RESET_AT, kind: "five_hour", subject: "claude" });
  });

  it("gates both CLIs on the pool's spent window", async () => {
    // One account, one counter (lib/plan-pools.ts): the payload carries the ACCOUNT's window on both
    // CLIs, and a spent window holds a puku thread exactly as it holds a Claude Code one.
    plans({
      plans: {
        claude: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, fiveHourAt: NOW, reportedAt: NOW },
        puku: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, fiveHourAt: NOW, reportedAt: NOW },
      },
    });
    await loadGates();
    expect(renderHook(() => useStartGate("claude", undefined)).result.current).toEqual({ at: RESET_AT, kind: "five_hour", subject: "claude" });
    expect(renderHook(() => useStartGate("puku", undefined)).result.current).toEqual({ at: RESET_AT, kind: "five_hour", subject: "puku" });
  });

  it("doesn't gate a CLI on another plan's spent window", async () => {
    // A Codex thread is on OpenAI's plan: Anthropic's spent window says nothing about it.
    plans({
      plans: {
        claude: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, fiveHourAt: NOW, reportedAt: NOW },
        codex: { reportedAt: NOW },
      },
    });
    await loadGates();
    expect(renderHook(() => useStartGate("codex", undefined)).result.current).toBeUndefined();
  });

  it("dates the window with the pool's read time, not the reporting CLI's", async () => {
    // The pool's window was read at 10:00; puku reported at 11:00. The window belongs to the pool, so
    // the sample that answers the gate is the pool's reading — puku's own last report cannot make a
    // window look newer (or older) than it is.
    const POOL_READ = NOW - 60 * 60 * 1000;
    plans({
      plans: {
        claude: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, fiveHourAt: POOL_READ, reportedAt: POOL_READ },
        puku: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, fiveHourAt: POOL_READ, reportedAt: NOW },
      },
    });
    await loadGates();
    expect(renderHook(() => useStartGate("puku", undefined)).result.current).toEqual({ at: RESET_AT, kind: "five_hour", subject: "puku" });
  });

  it("reads one window per pool, not one per CLI", () => {
    // The payload carries the account's window on every CLI of the plan. Read as two readings of one
    // counter, the newer of the two would win — and the older copy could hold a stale number. One
    // sample per pool is what the plan log holds, so that is what the gate reads.
    const samples = samplesOf({
      claude: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, fiveHourAt: NOW, reportedAt: NOW },
      puku: { fiveHour: { used: 100, resetsAt: RESET_AT / 1000 }, fiveHourAt: NOW, reportedAt: NOW },
      codex: { sevenDay: { used: 40, resetsAt: RESET_AT / 1000 }, sevenDayAt: NOW, reportedAt: NOW },
    });
    expect(samples).toEqual([
      { backend: "claude", kind: "five_hour", used: 100, resetsAt: RESET_AT / 1000, at: NOW },
      { backend: "codex", kind: "seven_day", used: 40, resetsAt: RESET_AT / 1000, at: NOW },
    ]);
  });

  it("answers with the model's own cap", async () => {
    plans({ plans: {}, models: [{ model: "opus", at: NOW, resetsAt: RESET_AT }] });
    await loadGates();
    const { result } = renderHook(() => useStartGate("claude", "opus"));
    expect(result.current).toEqual({ at: RESET_AT, kind: "model", subject: "opus" });
  });

  it("has no answer when nothing is spent", async () => {
    plans({ plans: { claude: { fiveHour: { used: 20, resetsAt: RESET_AT / 1000 }, reportedAt: NOW } } });
    await loadGates();
    const { result } = renderHook(() => useStartGate("claude", "opus"));
    expect(result.current).toBeUndefined();
  });

  it("answers with the CLI's weekly window", async () => {
    plans({ plans: { claude: { sevenDay: { used: 100, resetsAt: RESET_AT / 1000 }, reportedAt: NOW } } });
    await loadGates();
    const { result } = renderHook(() => useStartGate("claude", "opus"));
    expect(result.current).toEqual({ at: RESET_AT, kind: "seven_day", subject: "claude" });
  });

  it("reads a plan reading with no windows", async () => {
    plans({ plans: { claude: { reportedAt: NOW } } });
    await loadGates();
    const { result } = renderHook(() => useStartGate("claude", "opus"));
    expect(result.current).toBeUndefined();
  });

  it("skips a CLI with no reading", async () => {
    plans({ plans: { claude: undefined } });
    await loadGates();
    const { result } = renderHook(() => useStartGate("claude", "opus"));
    expect(result.current).toBeUndefined();
  });

  it("reads a window with no reset time", async () => {
    plans({ plans: { claude: { fiveHour: { used: 100 }, reportedAt: NOW } } });
    await loadGates();
    const { result } = renderHook(() => useStartGate("claude", "opus"));
    expect(result.current).toBeUndefined();
  });
});

describe("useThreadGate", () => {
  it("has no answer while the numbers aren't in yet", () => {
    const { result } = renderHook(() => useThreadGate(undefined, undefined, "claude", "opus"));
    expect(result.current).toBeUndefined();
  });

  it("answers with the thread's own window", async () => {
    plans({ plans: {} });
    await loadGates();
    const { result } = renderHook(() => useThreadGate({ used: 100, resetsAt: RESET_AT / 1000 }, undefined, "claude", "opus"));
    expect(result.current).toEqual({ at: RESET_AT, kind: "five_hour", subject: "claude" });
  });

  it("answers with the model's own cap", async () => {
    plans({ plans: {}, models: [{ model: "opus", at: NOW, resetsAt: RESET_AT }] });
    await loadGates();
    const { result } = renderHook(() => useThreadGate(undefined, undefined, "claude", "opus"));
    expect(result.current).toEqual({ at: RESET_AT, kind: "model", subject: "opus" });
  });

  it("answers with the CLI's weekly window", async () => {
    plans({ plans: { claude: { sevenDay: { used: 100, resetsAt: RESET_AT / 1000 }, reportedAt: NOW } } });
    await loadGates();
    const { result } = renderHook(() => useThreadGate(undefined, undefined, "claude", "opus"));
    expect(result.current).toEqual({ at: RESET_AT, kind: "seven_day", subject: "claude" });
  });

  it("falls back to the plan's next reset when the thread's window has no reset time", async () => {
    plans({ plans: {} });
    await loadGates();
    const { result } = renderHook(() => useThreadGate({ used: 100 }, RESET_AT, "claude", "opus"));
    expect(result.current).toEqual({ at: RESET_AT, kind: "five_hour", subject: "claude" });
  });

  it("has no answer when nothing is spent", async () => {
    plans({ plans: { claude: { fiveHour: { used: 20, resetsAt: RESET_AT / 1000 }, reportedAt: NOW } } });
    await loadGates();
    const { result } = renderHook(() => useThreadGate(undefined, undefined, "claude", "opus"));
    expect(result.current).toBeUndefined();
  });
});
