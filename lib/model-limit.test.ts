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
  // A fixed "now": 2026-10-25T19:30:00Z, which is 02:30 the next day in Bangkok (UTC+7) and
  // 15:30 the same day in New York (UTC-4 in October). Fixed, so the expectations below pin the
  // arithmetic instead of the wall clock.
  const AT = Date.UTC(2026, 9, 25, 19, 30);
  // Just after that, so a reset at 2:30am in Bangkok is still ahead rather than exactly now.
  const AT_EARLY = Date.UTC(2026, 9, 25, 19, 0);
  // What a zone reads an instant as, as "Oct 26, 02:30" and the like.
  const inZone = (ms: number, zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .format(new Date(ms))
      .replace(",", "");

  it("reads the epoch form after a pipe", async () => {
    const m = await load();
    expect(m.resetTimeOf("You've hit your limit |1792268400")).toBe(1792268400 * 1000);
  });

  it("reads the local time with a named zone", async () => {
    const m = await load();
    const reset = m.resetTimeOf("You've hit your session limit · resets 2:30am (Asia/Bangkok)", AT_EARLY);
    expect(reset).toBeDefined();
    // The named zone is honoured, and it is the zone's own day: 2:30am in Bangkok on the 26th.
    expect(inZone(reset!, "Asia/Bangkok")).toBe("10/26/2026 02:30");
  });

  it("rolls a reset that is exactly now forward a day", async () => {
    const m = await load();
    // 19:30 UTC is exactly 2:30am in Bangkok, so that reset has arrived: it names the next one.
    const reset = m.resetTimeOf("resets 2:30am (Asia/Bangkok)", AT);
    expect(inZone(reset!, "Asia/Bangkok")).toBe("10/27/2026 02:30");
  });

  it("reads a 12-hour time without minutes", async () => {
    const m = await load();
    const reset = m.resetTimeOf("resets 10pm (Asia/Bangkok)", AT);
    expect(reset).toBeDefined();
    // 10pm in Bangkok is 15:00 UTC, and it is still today in Bangkok (the 26th).
    expect(new Date(reset!).getUTCHours()).toBe(15);
    expect(inZone(reset!, "Asia/Bangkok")).toBe("10/26/2026 22:00");
  });

  it("rolls a reset in the past forward a day", async () => {
    const m = await load();
    // 1:00am Bangkok is 18:00 UTC on the 25th, before `at` — so it names the next one.
    const reset = m.resetTimeOf("resets 1:00am (Asia/Bangkok)", AT);
    expect(reset).toBeDefined();
    expect(reset!).toBeGreaterThan(AT);
    expect(inZone(reset!, "Asia/Bangkok")).toBe("10/27/2026 01:00");
  });

  it("reads the day in the zone, not the day in UTC", async () => {
    const m = await load();
    // 19:30 UTC is already the 26th in Bangkok. A reset named for 3pm belongs to the 26th there,
    // not the 25th.
    const reset = m.resetTimeOf("resets 3pm (Asia/Bangkok)", AT);
    expect(inZone(reset!, "Asia/Bangkok")).toBe("10/26/2026 15:00");
  });

  it("reads a zone west of UTC on its own day", async () => {
    const m = await load();
    // 15:30 in New York is still the 25th, so 10pm there is the 25th.
    const reset = m.resetTimeOf("resets 10pm (America/New_York)", AT);
    expect(inZone(reset!, "America/New_York")).toBe("10/25/2026 22:00");
    // And 1am there has passed, so it rolls to the 26th.
    const past = m.resetTimeOf("resets 1am (America/New_York)", AT);
    expect(inZone(past!, "America/New_York")).toBe("10/26/2026 01:00");
  });

  it("returns undefined when no reset is named", async () => {
    const m = await load();
    expect(m.resetTimeOf("Something else went wrong")).toBeUndefined();
  });
});
