// weft.zip's taps on a worker's live screen (lib/screen-input.ts): the same `input` row the worker reads, never an offer.
import { describe, expect, it } from "vitest";
import { plainInputCommand, plainScreenInput } from "./screen-input";

const target = { orgId: "o1", device: "worker:w1", folder: "app", cardId: "c1" };

describe("plainInputCommand", () => {
  it("builds a tap, a swipe and a watch for the card's worker", () => {
    expect(plainInputCommand(target, { kind: "tap", device: " d ", x: 0.5, y: 0.25 })).toEqual({
      org_id: "o1",
      kind: "input",
      target_device: "worker:w1",
      folder: "app",
      payload: { cardId: "c1", kind: "tap", device: "d", x: 0.5, y: 0.25 },
    });
    expect(plainInputCommand(target, { kind: "swipe", device: "d", x: 0, y: 0, x2: 1, y2: 1, ms: 200 })?.payload).toMatchObject({ kind: "swipe", x2: 1, y2: 1, ms: 200 });
    expect(plainInputCommand(target, { kind: "swipe", device: "d", x: 0, y: 0, x2: 1, y2: 1 })?.payload).not.toHaveProperty("ms");
    expect(plainInputCommand(target, { kind: "watch" })?.payload).toEqual({ cardId: "c1", kind: "watch" });
    expect(plainInputCommand(target, { kind: "watch", device: "d" })?.payload).toEqual({ cardId: "c1", kind: "watch", device: "d" });
  });

  it("refuses an offer, a point that isn't a number, a swipe with no end and no device", () => {
    expect(plainInputCommand(target, { kind: "offer", device: "d", sdp: "x" })).toBeNull();
    expect(plainScreenInput({ kind: "tap", device: "d", x: Number.NaN, y: 0 })).toBeNull();
    expect(plainScreenInput({ kind: "swipe", device: "d", x: 0, y: 0 })).toBeNull();
    expect(plainScreenInput({ kind: "tap", x: 0, y: 0 })).toBeNull();
    expect(plainScreenInput(null)).toBeNull();
  });
});
