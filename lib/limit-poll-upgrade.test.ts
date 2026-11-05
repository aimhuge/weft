import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The 15-minute background poll (lib/limit-poll.ts) noticing that the user UPGRADED their plan.
//
// This is its own file because it drives the poller's timer, and the poller's timer is a process
// singleton: a file that also tests other ticks would leave its interval running into the next
// test, and the next test's poll would answer with the previous test's mock.
//
// The stub: runner-session's open() hands back a session whose usage answer is the CLI's, and
// settings says which CLI to ask.

let dir = "";
let usageMock: ReturnType<typeof vi.fn>;

vi.mock("./runner-session", () => ({
  open: vi.fn(() => ({
    query: {
      // Calls THROUGH to usageMock, so the function that runs is the one this test set up:
      // vi.resetModules() rebuilds the module graph underneath the mock.
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: (...args: unknown[]) => (usageMock as (...a: unknown[]) => unknown)(...args),
    },
    abort: { signal: { aborted: false } },
  })),
  ensureSpare: vi.fn(),
  close: vi.fn(),
}));

vi.mock("./settings", () => ({
  defaultBackend: () => "claude" as const,
  listProjects: () => [{ path: "/repo", lastUsedAt: 1 }],
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"], now: 1_800_000_000_000 });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-poll-upgrade-"));
  process.env.WEFT_DATA = dir;
  delete (globalThis as Record<string, unknown>).__weftLimitPoll;
  delete (globalThis as Record<string, unknown>).__weftLimits;
  delete (globalThis as Record<string, unknown>).__weftSpares;
  delete (globalThis as Record<string, unknown>).__weftSessions;
  delete (globalThis as Record<string, unknown>).__weftModelLimits;
  usageMock = vi.fn(() => ({
    rate_limits: {
      five_hour: { utilization: 20, resets_at: null },
      seven_day: { utilization: 30, resets_at: null },
      seven_day_opus: { utilization: 100, resets_at: null },
    },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the poll and a plan upgrade", () => {
  it("frees a capped model once the CLI reports its weekly window has room", async () => {
    vi.resetModules();
    const { startLimitPoll } = await import("./limit-poll");
    const m = await import("./model-limit");
    const now = 1_800_000_000_000;

    // The user is at their weekly cap: Opus's own window is full and Weft remembers it.
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(true);

    // The user upgrades: the CLI now reports Opus's weekly window with room.
    usageMock.mockReturnValue({
      rate_limits: {
        five_hour: { utilization: 20, resets_at: null },
        seven_day: { utilization: 30, resets_at: null },
        seven_day_opus: { utilization: 6, resets_at: null },
      },
    });

    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);

    // The cap is gone: the model picker stops saying "at its limit", and a thread can go back to Opus.
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(false);
  });

  it("keeps the cap while the CLI still reports the model as full", async () => {
    vi.resetModules();
    const { startLimitPoll } = await import("./limit-poll");
    const m = await import("./model-limit");
    const now = 1_800_000_000_000;

    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);

    // No upgrade: Opus's own weekly window still reads 100% used.
    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);

    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(true);
  });
});
