import { describe, expect, it } from "vitest";
import { pendingItem, unsent, type PendingSend } from "./pending-sends";
import type { ThreadItem } from "./types";

const user = (text: string): ThreadItem => ({ kind: "user", text, at: 1 });
const reply = (text: string): ThreadItem => ({ kind: "assistant", text, at: 1 });
const send = (key: number, from: number, text = `s${key}`): PendingSend => ({ key, text, from, at: 5 });

describe("unsent", () => {
  it("passes no sends straight through", () => {
    const none: PendingSend[] = [];
    expect(unsent({ items: [user("a")], start: 0, total: 1 }, none)).toBe(none);
  });

  it("keeps a send until a user item lands at or after its index", () => {
    const pending = [send(1, 2)];
    expect(unsent({ items: [user("a"), reply("b")], start: 0, total: 2 }, pending)).toEqual(pending);
    expect(unsent({ items: [user("a"), reply("b"), user("reworded")], start: 0, total: 3 }, pending)).toEqual([]);
  });

  it("matches each new user item to the oldest send, counting from the page's start", () => {
    const page = { items: [reply("x"), user("one")], start: 10, total: 12 };
    expect(unsent(page, [send(2, 11), send(1, 11)])).toEqual([send(2, 11)]);
  });

  it("skips non-user items and holes left by a live event", () => {
    const items = [reply("x")] as ThreadItem[];
    items[3] = reply("y");
    expect(unsent({ items, start: 0, total: 4 }, [send(1, 0)])).toEqual([send(1, 0)]);
  });
});

describe("pendingItem", () => {
  it("draws a send as a user message", () => {
    expect(pendingItem(send(1, 0, "hi"))).toEqual({ kind: "user", text: "hi", at: 5 });
  });
});
