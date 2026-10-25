import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LimitSample } from "./limit-chart";

// ~/.weft/limits.jsonl: a sample per change in a CLI's 5-hour or weekly window, a week and a day kept.

let dir = "";
const DAY = 24 * 60 * 60 * 1000;

async function load() {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__weftLimits;
  return import("./limit-history");
}

const file = () => path.join(dir, "limits.jsonl");
const lines = () => fs.readFileSync(file(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LimitSample);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-limits-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("recordLimits", () => {
  it("appends a sample per window that changed, and nothing for a repeat", async () => {
    const { recordLimits, readSamples } = await load();
    recordLimits("claude", { fiveHour: { used: 10, resetsAt: 600 }, sevenDay: { used: 3 } }, 1000);
    recordLimits("claude", { fiveHour: { used: 10, resetsAt: 600 } }, 2000);
    recordLimits("claude", { fiveHour: { used: 12, resetsAt: 600 } }, 3000);
    recordLimits("puku", { fiveHour: { used: 12, resetsAt: 600 } }, 4000);
    recordLimits("puku", { fiveHour: { used: 12, resetsAt: 600.4 } }, 4500);
    recordLimits("puku", { fiveHour: { used: 12, resetsAt: 599.7 } }, 4600);
    // puku has its own plan (lib/plan-pools.ts), so its reading is a reading of its own counter: it
    // gets a row, and only a change in the window is a sample.
    expect(lines()).toEqual([
      { at: 1000, backend: "claude", kind: "five_hour", used: 10, resetsAt: 600 },
      { at: 1000, backend: "claude", kind: "seven_day", used: 3 },
      { at: 3000, backend: "claude", kind: "five_hour", used: 12, resetsAt: 600 },
      { at: 4000, backend: "puku", kind: "five_hour", used: 12, resetsAt: 600 },
    ]);
    expect(readSamples(5000).map((s) => s.at)).toEqual([1000, 1000, 3000, 4000]);
  });

  it("picks up where the file left off after a restart", async () => {
    fs.writeFileSync(file(), JSON.stringify({ at: 1000, backend: "claude", kind: "seven_day", used: 40, resetsAt: 9 }) + "\n");
    const { recordLimits } = await load();
    recordLimits("claude", { sevenDay: { used: 40, resetsAt: 9 } }, 2000);
    expect(lines()).toHaveLength(1);
  });

  it("never throws when the folder can't be written", async () => {
    process.env.WEFT_DATA = path.join(dir, "file");
    fs.writeFileSync(path.join(dir, "file"), "");
    const { recordLimits } = await load();
    expect(() => recordLimits("claude", { fiveHour: { used: 1 } })).not.toThrow();
  });
});

describe("setOnLimitReset", () => {
  it("fires once when a window drops from 100% to <100%, with the new sample", async () => {
    const { recordLimits, setOnLimitReset } = await load();
    const seen: Array<{ backend: string; kind: string; used: number }> = [];
    setOnLimitReset((s) => seen.push({ backend: s.backend, kind: s.kind, used: s.used }));
    recordLimits("claude", { fiveHour: { used: 100, resetsAt: 600 } }, 1000);
    recordLimits("claude", { fiveHour: { used: 50, resetsAt: 700 } }, 2000);
    expect(seen).toEqual([{ backend: "claude", kind: "five_hour", used: 50 }]);
  });

  it("doesn't fire when the window stays under 100% (no transition)", async () => {
    const { recordLimits, setOnLimitReset } = await load();
    const seen: number[] = [];
    setOnLimitReset((s) => seen.push(s.used));
    recordLimits("claude", { fiveHour: { used: 80, resetsAt: 600 } }, 1000);
    recordLimits("claude", { fiveHour: { used: 60, resetsAt: 700 } }, 2000);
    expect(seen).toEqual([]);
  });

  it("doesn't fire twice for the same hit (only when crossing the threshold)", async () => {
    const { recordLimits, setOnLimitReset } = await load();
    const seen: number[] = [];
    setOnLimitReset((s) => seen.push(s.used));
    recordLimits("claude", { fiveHour: { used: 100, resetsAt: 600 } }, 1000);
    recordLimits("claude", { fiveHour: { used: 50, resetsAt: 700 } }, 2000);
    recordLimits("claude", { fiveHour: { used: 50, resetsAt: 700 } }, 3000);
    expect(seen).toEqual([50]);
  });

  it("fires per plan: each CLI's own reset is its own", async () => {
    // Each CLI has its own plan (lib/plan-pools.ts), so Claude Code's reset and puku's are two
    // counters: each fires when that CLI's own window drops below 100%.
    const { recordLimits, setOnLimitReset } = await load();
    const seen: string[] = [];
    setOnLimitReset((s) => seen.push(s.backend));
    recordLimits("claude", { fiveHour: { used: 100, resetsAt: 600 } }, 1000);
    recordLimits("puku", { fiveHour: { used: 100, resetsAt: 600 } }, 1500);
    recordLimits("puku", { fiveHour: { used: 40, resetsAt: 700 } }, 2000);
    recordLimits("claude", { fiveHour: { used: 30, resetsAt: 700 } }, 2500);
    expect(seen).toEqual(["puku", "claude"]);
  });

  it("fires once per plan: another plan's reset is its own", async () => {
    const { recordLimits, setOnLimitReset } = await load();
    const seen: string[] = [];
    setOnLimitReset((s) => seen.push(s.backend));
    recordLimits("claude", { fiveHour: { used: 100, resetsAt: 600 } }, 1000);
    recordLimits("codex", { fiveHour: { used: 100, resetsAt: 600 } }, 1500);
    recordLimits("codex", { fiveHour: { used: 40, resetsAt: 700 } }, 2000);
    recordLimits("claude", { fiveHour: { used: 30, resetsAt: 700 } }, 2500);
    expect(seen).toEqual(["codex", "claude"]);
  });

  it("fires for the weekly window too", async () => {
    const { recordLimits, setOnLimitReset } = await load();
    const seen: string[] = [];
    setOnLimitReset((s) => seen.push(s.kind));
    recordLimits("claude", { sevenDay: { used: 100 } }, 1000);
    recordLimits("claude", { sevenDay: { used: 70 } }, 2000);
    expect(seen).toEqual(["seven_day"]);
  });

  it("rounds resetsAt to the minute, matching the existing convention", async () => {
    // The existing test at the top uses 600.4 → 600, 599.7 → 600; 700 (11.67 minutes) rounds to 12.
    // This test pins the same behavior in the new reset-detection path so the chart stays consistent.
    const { recordLimits, setOnLimitReset } = await load();
    setOnLimitReset(() => undefined);
    recordLimits("claude", { fiveHour: { used: 100, resetsAt: 600 } }, 1000);
    recordLimits("claude", { fiveHour: { used: 50, resetsAt: 700 } }, 2000);
    expect(lines()).toEqual([
      { at: 1000, backend: "claude", kind: "five_hour", used: 100, resetsAt: 600 },
      { at: 2000, backend: "claude", kind: "five_hour", used: 50, resetsAt: 720 },
    ]);
  });

  it("returns the previous handler so callers can chain", async () => {
    const { setOnLimitReset } = await load();
    const first = () => {};
    const second = () => {};
    expect(setOnLimitReset(first)).toBeUndefined();
    expect(setOnLimitReset(second)).toBe(first);
  });

  it("swallows a handler throw so the chart still records the sample", async () => {
    const { recordLimits, setOnLimitReset } = await load();
    setOnLimitReset(() => {
      throw new Error("boom");
    });
    recordLimits("claude", { fiveHour: { used: 100, resetsAt: 600 } }, 1000);
    expect(() => recordLimits("claude", { fiveHour: { used: 50, resetsAt: 720 } }, 2000)).not.toThrow();
    expect(lines()).toEqual([
      { at: 1000, backend: "claude", kind: "five_hour", used: 100, resetsAt: 600 },
      { at: 2000, backend: "claude", kind: "five_hour", used: 50, resetsAt: 720 },
    ]);
  });
});

describe("readSamples", () => {
  it("is empty without a file", async () => {
    const { readSamples } = await load();
    expect(readSamples()).toEqual([]);
  });

  it("skips bad lines, sorts, and drops what's older than a week and a day from the file", async () => {
    const now = 20 * DAY;
    const old = { at: now - 9 * DAY, backend: "claude", kind: "five_hour", used: 1 };
    const b = { at: now - DAY, backend: "claude", kind: "five_hour", used: 5 };
    const a = { at: now - 2 * DAY, backend: "claude", kind: "seven_day", used: 2 };
    fs.writeFileSync(file(), [old, b, "not json", JSON.stringify({ at: "x" }), a].map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
    const { readSamples } = await load();
    expect(readSamples(now)).toEqual([a, b]);
    expect(lines()).toEqual([b, a]);
  });

  it("empties the file when nothing is kept", async () => {
    fs.writeFileSync(file(), JSON.stringify({ at: 0, backend: "claude", kind: "five_hour", used: 1 }) + "\n");
    const { readSamples } = await load();
    expect(readSamples(30 * DAY)).toEqual([]);
    expect(fs.readFileSync(file(), "utf8")).toBe("");
  });
});
