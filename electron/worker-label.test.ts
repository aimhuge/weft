import { describe, expect, it } from "vitest";
import { workerLabel } from "./worker-label.cjs";

const pins = (names: Record<string, string>) => ({ nameOf: (id: string) => names[id] ?? null });

describe("workerLabel", () => {
  it("uses the pinned name over the row's", () => {
    expect(workerLabel(pins({ w1: "m1mini" }), "w1", "your bank")).toBe("m1mini");
  });
  it("marks the row's name unverified when nothing is pinned, cleaned", () => {
    expect(workerLabel(pins({}), "w2", "box; `rm`")).toBe("box rm (name not verified)");
    expect(workerLabel(pins({}), "w2", undefined)).toBe("a worker (name not verified)");
  });
});
