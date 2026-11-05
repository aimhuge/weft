import { describe, expect, it } from "vitest";
import { isWorkerItem, parseWorkerItem, workerItemId } from "./worker-item-id";

describe("a worker's cron or webhook id", () => {
  it("round-trips the worker and the item's own id", () => {
    const id = workerItemId("w1", "c:1");
    expect(id).toBe("worker:w1:c:1");
    expect(isWorkerItem(id)).toBe(true);
    expect(parseWorkerItem(id)).toEqual({ workerId: "w1", id: "c:1" });
  });

  it("is null for this Mac's own and for a broken one", () => {
    expect(parseWorkerItem("c1")).toBeNull();
    expect(parseWorkerItem("worker:w1")).toBeNull();
    expect(parseWorkerItem("worker::c1")).toBeNull();
    expect(parseWorkerItem("worker:w1:")).toBeNull();
  });
});
