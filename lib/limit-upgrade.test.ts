import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanRateLimits } from "./limit-kind";

// Detecting that the user upgraded their Claude plan (lib/limit-upgrade.ts): the CLI's answer reports
// the per-model weekly windows, and when a model Weft holds a cap on now has room again, the cap is
// stale and the model can run. The store it writes to is the real one (lib/model-limit.ts), on a
// temporary WEFT_DATA, so the tests read the file back like the app does.

let dir = "";
const g = globalThis as unknown as { __weftModelLimits?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftModelLimits;
  return import("./limit-upgrade");
}

// The SDK's answer shape, with the per-model weekly windows that carry the model's own cap.
function limits(over: Partial<PlanRateLimits> = {}): PlanRateLimits {
  return {
    five_hour: { utilization: 12, resets_at: null },
    seven_day: { utilization: 40, resets_at: null },
    seven_day_opus: { utilization: 100, resets_at: null },
    ...over,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-upgrade-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftModelLimits;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("releasedModels", () => {
  it("releases a capped model once the CLI reports its window has room", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(true);
    // The upgrade: Opus's own weekly window now reads 8% used instead of 100%.
    expect(u.releasedModels(limits({ seven_day_opus: { utilization: 8, resets_at: null } }), now)).toEqual(["claude-opus-5-5"]);
  });

  it("keeps the cap while the model is still full", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    // Still at 100%: the cap stands.
    expect(u.releasedModels(limits(), now)).toEqual([]);
  });

  it("releases only the model the answer names", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    m.recordModelLimit("claude-sonnet-5-5", now, now + 86_400_000);
    // Opus has room, Sonnet is still full: only Opus is released.
    const released = u.releasedModels(
      limits({ seven_day_opus: { utilization: 5, resets_at: null }, seven_day_sonnet: { utilization: 100, resets_at: null } }),
      now,
    );
    expect(released).toEqual(["claude-opus-5-5"]);
  });

  it("releases a cap the CLI's own scoped rows name", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-fable-5-5", now, now + 86_400_000);
    const released = u.releasedModels(
      limits({ model_scoped: [{ display_name: "Fable", utilization: 3, resets_at: null }] }),
      now,
    );
    expect(released).toEqual(["claude-fable-5-5"]);
  });

  it("holds the cap when the answer says nothing about that model", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    // No per-model windows in the answer at all: Weft learns nothing, so nothing is released.
    expect(u.releasedModels({ five_hour: { utilization: 10, resets_at: null } }, now)).toEqual([]);
  });

  it("holds the cap when the window it names has already reset", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    // The window reads 5% used but its reset is in the past: it says nothing about the cap.
    const past = new Date(now - 1000).toISOString();
    expect(u.releasedModels(limits({ seven_day_opus: { utilization: 5, resets_at: past } }), now)).toEqual([]);
  });

  it("releases a cap on a window that is open and has room", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    const future = new Date(now + 86_400_000).toISOString();
    expect(u.releasedModels(limits({ seven_day_opus: { utilization: 5, resets_at: future } }), now)).toEqual(["claude-opus-5-5"]);
  });

  it("releases nothing when no model is capped", async () => {
    const u = await load();
    expect(u.releasedModels(limits(), Date.now())).toEqual([]);
  });
});

describe("releaseUpgradedModels", () => {
  it("forgets the cap, so the model can be picked again", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    const released = u.releaseUpgradedModels(limits({ seven_day_opus: { utilization: 4, resets_at: null } }), now);
    expect(released).toEqual(["claude-opus-5-5"]);
    // The store no longer holds the cap: the model picker stops saying "at its limit".
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(false);
  });

  it("leaves a cap that is still full in place", async () => {
    const u = await load();
    const m = await import("./model-limit");
    const now = Date.now();
    m.recordModelLimit("claude-opus-5-5", now, now + 86_400_000);
    u.releaseUpgradedModels(limits(), now);
    expect(m.isModelLimited("claude-opus-5-5", now)).toBe(true);
  });
});
