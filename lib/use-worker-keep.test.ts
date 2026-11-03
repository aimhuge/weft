// lib/use-worker-keep.ts outside a browser (the server render): no bridge to find. The hook is driven through
// components/WorkerKeep.test.tsx.
import { describe, expect, it } from "vitest";
import { workerKeepBridge } from "./use-worker-keep";

describe("workerKeepBridge", () => {
  it("finds none without a window", () => {
    expect(workerKeepBridge()).toBeUndefined();
  });
});
