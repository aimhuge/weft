import { describe, expect, it } from "vitest";
import { hostChipLabel, hostChipShown, hostName } from "./host-chip";

describe("hostChipLabel", () => {
  it("names the worker a card runs on", () => {
    expect(hostChipLabel({ worker: "m1mini", streaming: false, localOn: false })).toBe("m1mini");
  });

  it("adds the simulator while the worker streams one", () => {
    expect(hostChipLabel({ worker: "m1mini", streaming: true, localOn: false })).toBe("m1mini + simulator");
  });

  it("says this Mac in Local Simulator mode, whatever the worker streamed", () => {
    expect(hostChipLabel({ worker: "m1mini", streaming: true, localOn: true })).toBe("this Mac + simulator");
  });

  it("says Worker where the board doesn't know its name", () => {
    expect(hostChipLabel({ streaming: true, localOn: false })).toBe("Worker + simulator");
    expect(hostName("  ")).toBe("Worker");
  });
});

describe("hostChipShown", () => {
  it("always shows on the desktop's worker card, and on the web only with a simulator to show or start", () => {
    expect(hostChipShown({ local: true, streaming: false, canStart: false })).toBe(true);
    expect(hostChipShown({ local: false, streaming: true, canStart: false })).toBe(true);
    expect(hostChipShown({ local: false, streaming: false, canStart: true })).toBe(true);
    expect(hostChipShown({ local: false, streaming: false, canStart: false })).toBe(false);
  });
});
