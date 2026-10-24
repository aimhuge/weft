import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store of exhausted models: which model ran out, and until when. It lives in ~/.weft so it
// survives a restart, and it is per model — a hit on Opus says nothing about Sonnet.

let dir: string;
const g = globalThis as unknown as { __weftModelLimits?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftModelLimits;
  return import("./model-limit");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-model-limit-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftModelLimits;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("model limits", () => {
  it("starts with nothing limited", async () => {
    const m = await load();
    expect(m.modelLimits()).toEqual([]);
    expect(m.isModelLimited("claude-opus-5-5")).toBe(false);
    expect(m.modelLimit("claude-opus-5-5")).toBeUndefined();
  });

  it("records a hit and reads it back", async () => {
    const m = await load();
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(true);
    expect(m.modelLimit("claude-opus-5-5", now)?.resetsAt).toBe(now + 60_000);
    expect(m.limitedModels(now)).toEqual(["claude-opus-5-5"]);
  });

  it("a hit on one model says nothing about another", async () => {
    const m = await load();
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    expect(m.isModelLimited("claude-sonnet-5-5", now)).toBe(false);
    expect(m.isModelLimited("puku-ai-2.8", now)).toBe(false);
  });

  it("falls back to the window's own length when no reset is named", async () => {
    const m = await load();
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now);
    const limit = m.modelLimit("claude-opus-5-5", now);
    expect(limit).toBeDefined();
    expect(limit!.resetsAt).toBeGreaterThan(now);
  });

  it("a hit stops counting once its window has passed", async () => {
    const m = await load();
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 1_000);
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(true);
    expect(m.isModelLimited("claude-opus-5-5", now + 2_000)).toBe(false);
    expect(m.modelLimits(now + 2_000)).toEqual([]);
  });

  it("a second hit on the same model moves its reset further out", async () => {
    const m = await load();
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    m.recordModelLimit("claude-opus-5-5", now + 1_000, now + 120_000);
    expect(m.modelLimits(now).length).toBe(1);
    expect(m.modelLimit("claude-opus-5-5", now)?.resetsAt).toBe(now + 120_000);
  });

  it("forgets a model on request, so a thread can go back to it", async () => {
    const m = await load();
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    m.clearModelLimit("claude-opus-5-5");
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(false);
  });

  it("survives a restart: the file is read back from disk", async () => {
    const m = await load();
    const now = Date.now();
    m.recordModelLimit("puku-ai-2.8", now, now + 60_000);
    const again = await load();
    expect(again.isModelLimited("puku-ai-2.8", now)).toBe(true);
  });

  it("ignores an empty model", async () => {
    const m = await load();
    m.recordModelLimit("", Date.now(), Date.now() + 1_000);
    expect(m.modelLimits()).toEqual([]);
  });
});

describe("resetTimeOf", () => {
  it("reads the epoch form after a pipe", async () => {
    const m = await load();
    expect(m.resetTimeOf("You've hit your limit |1792268400")).toBe(1792268400 * 1000);
  });

  it("reads the local time with a named zone", async () => {
    const m = await load();
    const at = Date.now();
    const reset = m.resetTimeOf("You've hit your session limit · resets 2:30am (Asia/Bangkok)", at);
    expect(reset).toBeDefined();
    // The named zone is honoured: 2:30am in Bangkok is 19:30 UTC the day before.
    expect(new Date(reset!).toISOString()).toContain("19:30:00");
  });

  it("reads a 12-hour time without minutes", async () => {
    const m = await load();
    const at = Date.now();
    const reset = m.resetTimeOf("resets 10pm (Asia/Bangkok)", at);
    expect(reset).toBeDefined();
    expect(new Date(reset!).getUTCHours()).toBe(15);
  });

  it("rolls a reset in the past forward a day", async () => {
    const m = await load();
    const at = Date.now();
    const reset = m.resetTimeOf("resets 1:00am (Asia/Bangkok)", at);
    expect(reset).toBeDefined();
    expect(reset!).toBeGreaterThan(at);
  });

  it("returns undefined when no reset is named", async () => {
    const m = await load();
    expect(m.resetTimeOf("Something else went wrong")).toBeUndefined();
  });
});
