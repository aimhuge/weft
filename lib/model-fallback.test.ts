import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The rule: a thread on a model that has hit its limit moves to the user's backup model. It
// applies to every kind of thread, because they all pick a model the same way. The backup may
// live on another CLI — the thread moves there rather than wait for a reset.

let dir: string;
const g = globalThis as unknown as { __weftModelLimits?: unknown; __weftSettings?: unknown; __weftState?: unknown };

async function load() {
  vi.resetModules();
  delete g.__weftModelLimits;
  delete g.__weftSettings;
  delete g.__weftState;
  return import("./model-fallback");
}

async function setBackup(model: string) {
  const s = await import("./settings");
  s.setBackupModel(model);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-model-fallback-"));
  process.env.WEFT_DATA = dir;
});
afterEach(() => {
  delete g.__weftModelLimits;
  delete g.__weftSettings;
  delete g.__weftState;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("fallbackFor", () => {
  it("does nothing when there is no model", async () => {
    const m = await load();
    expect(m.fallbackFor(undefined)).toBeUndefined();
    expect(m.fallbackFor("")).toBeUndefined();
  });

  it("does nothing when the model is fine", async () => {
    const m = await load();
    await setBackup("puku-ai-2.8");
    expect(m.fallbackFor("claude-opus-5-5")).toBeUndefined();
  });

  it("does nothing when no backup model is set", async () => {
    const m = await load();
    const limits = await import("./model-limit");
    const now = Date.now();
    limits.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    expect(m.fallbackFor("claude-opus-5-5", now)).toBeUndefined();
  });

  it("moves an exhausted model to the backup", async () => {
    const m = await load();
    const limits = await import("./model-limit");
    const now = Date.now();
    await setBackup("puku-ai-2.8");
    limits.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    const fallback = m.fallbackFor("claude-opus-5-5", now);
    expect(fallback?.model).toBe("puku-ai-2.8");
    expect(fallback?.backend).toBe("puku");
    expect(fallback?.from).toBe("claude-opus-5-5");
  });

  it("a backup on the same CLI keeps that CLI", async () => {
    const m = await load();
    const limits = await import("./model-limit");
    const now = Date.now();
    await setBackup("claude-sonnet-5-5");
    limits.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    const fallback = m.fallbackFor("claude-opus-5-5", now);
    expect(fallback?.model).toBe("claude-sonnet-5-5");
    expect(fallback?.backend).toBe("claude");
  });

  it("will not fall back onto the model that is exhausted", async () => {
    const m = await load();
    const limits = await import("./model-limit");
    const now = Date.now();
    await setBackup("claude-opus-5-5");
    limits.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    expect(m.fallbackFor("claude-opus-5-5", now)).toBeUndefined();
  });

  it("a hit on another model doesn't move this one", async () => {
    const m = await load();
    const limits = await import("./model-limit");
    const now = Date.now();
    await setBackup("puku-ai-2.8");
    limits.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    expect(m.fallbackFor("claude-sonnet-5-5", now)).toBeUndefined();
  });
});

describe("modelWithFallback", () => {
  it("leaves a fine model alone", async () => {
    const m = await load();
    await setBackup("puku-ai-2.8");
    expect(m.modelWithFallback("claude", "claude-opus-5-5")).toEqual({
      backend: "claude",
      model: "claude-opus-5-5",
      switched: false,
    });
  });

  it("moves the CLI with the model when the backup is on another CLI", async () => {
    const m = await load();
    const limits = await import("./model-limit");
    const now = Date.now();
    await setBackup("puku-ai-2.8");
    limits.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    expect(m.modelWithFallback("claude", "claude-opus-5-5", now)).toEqual({
      backend: "puku",
      model: "puku-ai-2.8",
      switched: true,
    });
  });

  it("a model the CLI doesn't serve becomes the CLI's own choice", async () => {
    const m = await load();
    // A Claude id on a Puku card: the gateway would answer it as puku-ai-2.8, so the chip
    // would lie. The CLI decides instead.
    expect(m.modelWithFallback("puku", "claude-opus-5-5")).toEqual({
      backend: "puku",
      model: undefined,
      switched: false,
    });
  });
});

describe("the fallback line", () => {
  it("names the model it left and the one it moved to", async () => {
    const m = await load();
    expect(m.fallbackLine("Opus 5.5", "Puku AI 2.8")).toBe("Opus 5.5 hit its limit — moved to Puku AI 2.8");
  });
});

describe("resolveWithFallback", () => {
  it("keeps the model when it's fine", async () => {
    const m = await load();
    await setBackup("puku-ai-2.8");
    expect(m.resolveWithFallback("claude-opus-5-5")).toBe("claude-opus-5-5");
  });

  it("returns the backup when the model is exhausted", async () => {
    const m = await load();
    const limits = await import("./model-limit");
    const now = Date.now();
    await setBackup("puku-ai-2.8");
    limits.recordModelLimit("claude-opus-5-5", now, now + 60_000);
    expect(m.resolveWithFallback("claude-opus-5-5", now)).toBe("puku-ai-2.8");
  });

  it("no model at all stays no model", async () => {
    const m = await load();
    expect(m.resolveWithFallback(undefined)).toBe("");
  });
});
