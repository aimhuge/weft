import { describe, expect, it } from "vitest";
import { hidUsage } from "./hid-keys";
import { liveEvent, newAnswerKey, openAnswer, PASTE_MAX, pasteEvent, sealAnswer } from "./rtc-signal";

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

describe("a paste", () => {
  it("goes as text, cut to the cap, and nothing when empty", () => {
    expect(pasteEvent("hi")).toEqual({ t: "text", text: "hi" });
    expect(pasteEvent("x".repeat(PASTE_MAX + 5))).toEqual({ t: "text", text: "x".repeat(PASTE_MAX) });
    expect(pasteEvent("")).toBeNull();
  });

  it("is read back only as non-empty text under the cap", () => {
    expect(liveEvent('{"t":"text","text":"a b"}')).toEqual({ t: "text", text: "a b" });
    expect(liveEvent('{"t":"text","text":""}')).toBeNull();
    expect(liveEvent('{"t":"text","text":3}')).toBeNull();
    expect(liveEvent(JSON.stringify({ t: "text", text: "x".repeat(PASTE_MAX + 1) }))).toBeNull();
  });
});
