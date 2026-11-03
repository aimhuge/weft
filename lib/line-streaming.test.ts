import { describe, expect, it } from "vitest";
import type { LineEvent } from "./host-line-protocol";
import { NOT_STREAMING, streamedAfter } from "./line-streaming";
import type { ThreadItem } from "./types";

const delta = (text: string, index = 2, over: Partial<Extract<LineEvent, { t: "delta" }>> = {}): LineEvent => ({ t: "delta", cardId: "c1", index, text, ...over });
const item = (kind: string): LineEvent => ({ t: "thread", cardId: "c1", index: 2, item: { kind, text: "x", at: 0 } as unknown as ThreadItem });

describe("streamedAfter", () => {
  it("grows the reply, starts anew on another index or a reset, and ends when it lands", () => {
    let s = streamedAfter(NOT_STREAMING, delta("Hello "), "c1");
    s = streamedAfter(s, delta("world "), "c1");
    expect(s).toEqual({ index: 2, text: "Hello world " });
    expect(streamedAfter(s, delta("Again ", 4), "c1")).toEqual({ index: 4, text: "Again " });
    expect(streamedAfter(s, delta("‹hidden› ", 2, { reset: true }), "c1")).toEqual({ index: 2, text: "‹hidden› " });
    expect(streamedAfter(s, item("tool"), "c1")).toBe(s);
    expect(streamedAfter(s, item("assistant"), "c1")).toBe(NOT_STREAMING);
    expect(streamedAfter(s, item("result"), "c1")).toBe(NOT_STREAMING);
    expect(streamedAfter(s, { t: "thread_cleared", cardId: "c1" }, "c1")).toBe(NOT_STREAMING);
  });

  it("leaves it alone for another card or another kind of event", () => {
    const s = { index: 2, text: "Hi " };
    expect(streamedAfter(s, delta("x ", 2, { cardId: "c2" }), "c1")).toBe(s);
    expect(streamedAfter(s, { t: "thread_cleared", cardId: "c2" }, "c1")).toBe(s);
    expect(streamedAfter(s, { t: "card_deleted", id: "c1" }, "c1")).toBe(s);
    expect(streamedAfter(s, { ...item("assistant"), cardId: "c2" } as LineEvent, "c1")).toBe(s);
  });
});
