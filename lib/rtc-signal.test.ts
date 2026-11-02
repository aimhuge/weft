import { describe, expect, it } from "vitest";
import { hidUsage } from "./hid-keys";
import { liveEvent, newAnswerKey, openAnswer, sealAnswer } from "./rtc-signal";

describe("the answer", () => {
  it("opens with the key the offer carried", async () => {
    const key = newAnswerKey();
    await expect(openAnswer(key, await sealAnswer(key, "v=0"))).resolves.toBe("v=0");
  });

  it("refuses one forged with any other key, or changed on the way", async () => {
    const key = newAnswerKey();
    await expect(openAnswer(key, await sealAnswer(newAnswerKey(), "evil"))).rejects.toThrow();
    const sealed = await sealAnswer(key, "v=0");
    await expect(openAnswer(key, { ...sealed, ct: btoa("tampered-with") })).rejects.toThrow();
  });
});

describe("liveEvent", () => {
  it("reads a gesture and a key", () => {
    expect(liveEvent('{"t":"down","x":0,"y":1}')).toEqual({ t: "down", x: 0, y: 1 });
    expect(liveEvent('{"t":"key","code":40,"down":false}')).toEqual({ t: "key", code: 40, down: false });
  });

  it("drops anything else", () => {
    for (const raw of ["{", '{"t":"down","x":2,"y":0}', '{"t":"key","code":1.5,"down":true}', '{"t":"key","code":4}', '{"t":"wipe"}']) expect(liveEvent(raw)).toBeNull();
  });
});

describe("hidUsage", () => {
  it("maps letters, digits and named keys, and refuses the rest", () => {
    expect(hidUsage("KeyA")).toBe(4);
    expect(hidUsage("KeyZ")).toBe(29);
    expect(hidUsage("Digit1")).toBe(30);
    expect(hidUsage("Digit0")).toBe(39);
    expect(hidUsage("Enter")).toBe(40);
    expect(hidUsage("ShiftLeft")).toBe(225);
    expect(hidUsage("F13")).toBeNull();
  });
});
