import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LimitSample } from "./limit-chart";

// The 15-minute background poll (lib/limit-poll.ts) records a sample into ~/.weft/limits.jsonl even
// when no Weft thread is running, by asking the CLI for its 5-hour and weekly usage. The test stubs
// runner-session's open/close/ensureSpare so the poller runs without spawning a real SDK process.

let dir = "";
let usageMock: ReturnType<typeof vi.fn>;
let utilization: { fiveHour: number; sevenDay: number };

// Antigravity's quota is its own module's (lib/antigravity-usage.test.ts): never run the real agy here.
const agyUsage = vi.hoisted(() => vi.fn(() => Promise.resolve(false)));
vi.mock("./antigravity-usage", () => ({ pollAntigravityUsage: agyUsage }));

vi.mock("./runner-session", () => ({
  open: vi.fn(() => ({
    query: { usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usageMock },
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-poll-"));
  process.env.WEFT_DATA = dir;
  delete (globalThis as Record<string, unknown>).__weftLimitPoll;
  delete (globalThis as Record<string, unknown>).__weftLimits;
  delete (globalThis as Record<string, unknown>).__weftSpares;
  delete (globalThis as Record<string, unknown>).__weftSessions;
  utilization = { fiveHour: 27, sevenDay: 4 };
  usageMock = vi.fn(() => ({
    rate_limits: {
      five_hour: { utilization: utilization.fiveHour, resets_at: null },
      seven_day: { utilization: utilization.sevenDay, resets_at: null },
    },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = () => path.join(dir, "limits.jsonl");
const lines = (): LimitSample[] => (fs.existsSync(file()) ? fs.readFileSync(file(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LimitSample) : []);

async function load() {
  vi.resetModules();
  return import("./limit-poll");
}

describe("startLimitPoll", () => {
  it("asks agy for Antigravity's quota on every tick", async () => {
    const { startLimitPoll, LIMITS_POLL_MS } = await load();
    agyUsage.mockClear();
    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);
    expect(agyUsage).toHaveBeenCalledWith(1_800_000_000_000);
    await vi.advanceTimersByTimeAsync(LIMITS_POLL_MS);
    expect(agyUsage).toHaveBeenCalledTimes(2);
  });

  it("records a sample on the first tick and on every interval, idempotently", async () => {
    const { startLimitPoll, LIMITS_POLL_MS } = await load();
    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toEqual([
      { at: 1_800_000_000_000, backend: "claude", kind: "five_hour", used: 27 },
      { at: 1_800_000_000_000, backend: "claude", kind: "seven_day", used: 4 },
    ]);

    // A second startLimitPoll does not stack timers; the second 0-time advance is a no-op.
    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toHaveLength(2);

    // 15 minutes later, the next interval fires. recordLimits dedups unchanged values, so advance
    // the mock so the new tick actually writes.
    utilization.fiveHour = 28;
    utilization.sevenDay = 5;
    await vi.advanceTimersByTimeAsync(LIMITS_POLL_MS);
    expect(lines()).toHaveLength(4);
    expect(lines().slice(2)).toEqual([
      { at: 1_800_000_000_000 + LIMITS_POLL_MS, backend: "claude", kind: "five_hour", used: 28 },
      { at: 1_800_000_000_000 + LIMITS_POLL_MS, backend: "claude", kind: "seven_day", used: 5 },
    ]);
  });

  it("does nothing for codex (no equivalent CLI usage API yet)", async () => {
    vi.doMock("./settings", () => ({
      defaultBackend: () => "codex" as const,
      listProjects: () => [{ path: "/repo", lastUsedAt: 1 }],
    }));
    const { startLimitPoll } = await load();
    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toEqual([]);
  });

  it("does nothing for Antigravity, which reads its usage with agy itself", async () => {
    vi.doMock("./settings", () => ({
      defaultBackend: () => "antigravity" as const,
      listProjects: () => [{ path: "/repo", lastUsedAt: 1 }],
    }));
    const { startLimitPoll } = await load();
    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toEqual([]);
  });

  it("skips writing when the CLI returns no rate_limits", async () => {
    usageMock.mockReturnValueOnce({});
    const { startLimitPoll } = await load();
    startLimitPoll();
    await vi.advanceTimersByTimeAsync(0);
    expect(lines()).toEqual([]);
  });
});
