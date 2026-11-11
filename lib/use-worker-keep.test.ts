// lib/use-worker-keep.ts: the bridge Forget and Revoke wipe a worker's kept secrets through, found only in Weft's window.
import { afterEach, describe, expect, it, vi } from "vitest";
import { workerKeepBridge } from "./use-worker-keep";

afterEach(() => vi.unstubAllGlobals());

describe("workerKeepBridge", () => {
  it("finds none without a window", () => {
    expect(workerKeepBridge()).toBeUndefined();
  });

  it("is main's bridge in the desktop app", () => {
    const workerKeep = { wipe: vi.fn() };
    vi.stubGlobal("window", { weft: { workerKeep } });
    expect(workerKeepBridge()).toBe(workerKeep);
  });
});
