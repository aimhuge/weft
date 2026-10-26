// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CRON_FROM_EVENT, onRepeatFrom, repeatFrom } from "./cron-events";

describe("repeatFrom", () => {
  it("dispatches the anchor with the card it came from", () => {
    const seen = vi.fn();
    window.addEventListener(CRON_FROM_EVENT, seen as EventListener);
    repeatFrom("card1", { id: "m1", text: "hello" });
    const event = seen.mock.calls[0]?.[0] as CustomEvent<{ cardId: string; anchor: { id?: string; text: string } }>;
    expect(event.detail).toEqual({ cardId: "card1", anchor: { id: "m1", text: "hello" } });
    window.removeEventListener(CRON_FROM_EVENT, seen as EventListener);
  });

  it("dispatches an anchor with no id too", () => {
    const seen = vi.fn();
    window.addEventListener(CRON_FROM_EVENT, seen as EventListener);
    repeatFrom("card1", { text: "the last one" });
    const event = seen.mock.calls[0]?.[0] as CustomEvent<{ cardId: string; anchor: { id?: string; text: string } }>;
    expect(event.detail.anchor).toEqual({ text: "the last one" });
    window.removeEventListener(CRON_FROM_EVENT, seen as EventListener);
  });
});

describe("onRepeatFrom", () => {
  it("calls back for its own card only", () => {
    const on = vi.fn();
    const off = onRepeatFrom("card1", on);
    repeatFrom("card2", { id: "m2", text: "other" });
    expect(on).not.toHaveBeenCalled();
    repeatFrom("card1", { id: "m1", text: "mine" });
    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith({ id: "m1", text: "mine" });
    off();
  });

  it("ignores an event with no detail", () => {
    const on = vi.fn();
    const off = onRepeatFrom("card1", on);
    window.dispatchEvent(new CustomEvent(CRON_FROM_EVENT));
    window.dispatchEvent(new Event(CRON_FROM_EVENT));
    expect(on).not.toHaveBeenCalled();
    off();
  });

  it("stops calling back once it's unsubscribed", () => {
    const on = vi.fn();
    const off = onRepeatFrom("card1", on);
    repeatFrom("card1", { id: "m1", text: "mine" });
    expect(on).toHaveBeenCalledTimes(1);
    off();
    repeatFrom("card1", { id: "m2", text: "later" });
    expect(on).toHaveBeenCalledTimes(1);
  });
});
