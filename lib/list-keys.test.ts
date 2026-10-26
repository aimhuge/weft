import { describe, expect, it } from "vitest";
import { listKey, type ListKeyEvent } from "./list-keys";

const key = (k: string, over: Partial<ListKeyEvent> = {}): ListKeyEvent => ({ key: k, meta: false, ctrl: false, alt: false, typing: false, blocked: false, ...over });

describe("listKey", () => {
  it("starts a title search on a typed letter, digit or symbol", () => {
    expect(listKey(key("f"), false)).toEqual({ kind: "search", text: "f" });
    expect(listKey(key("N"), false)).toEqual({ kind: "search", text: "N" });
    expect(listKey(key("4"), false)).toEqual({ kind: "search", text: "4" });
  });

  it("leaves j, k, ?, / and named keys to the board", () => {
    for (const k of ["j", "K", "?", "/", "Enter", "ArrowDown", "Escape"]) expect(listKey(key(k), false)).toEqual({ kind: "pass" });
  });

  it("makes Space a leader: B and R go to the quick adds, anything else passes on", () => {
    expect(listKey(key(" "), false)).toEqual({ kind: "leader" });
    expect(listKey(key("b"), true)).toEqual({ kind: "add", column: "backlog" });
    expect(listKey(key("R"), true)).toEqual({ kind: "add", column: "running" });
    expect(listKey(key("n"), true)).toEqual({ kind: "pass" });
  });

  it("stays out of the way with a modifier, in a field, or with something open", () => {
    for (const over of [{ meta: true }, { ctrl: true }, { alt: true }, { typing: true }, { blocked: true }]) {
      expect(listKey(key("f", over), false)).toEqual({ kind: "pass" });
      expect(listKey(key("b", over), true)).toEqual({ kind: "pass" });
    }
  });
});
