import { describe, expect, it } from "vitest";
import type { Editor } from "@tiptap/react";
import { mentionAtCursor, mentionIn } from "./composer-mention";

describe("mentionIn", () => {
  it("finds an @login at the start of a word, before the cursor", () => {
    expect(mentionIn("@al")).toBe("al");
    expect(mentionIn("hi @bob-1")).toBe("bob-1");
    expect(mentionIn("(@carol")).toBe("carol");
    expect(mentionIn("ask @")).toBe("");
  });

  it("finds nothing inside a word, after a space, or past 39 characters", () => {
    expect(mentionIn("me@example")).toBeNull();
    expect(mentionIn("@al ")).toBeNull();
    expect(mentionIn(`@${"a".repeat(40)}`)).toBeNull();
    expect(mentionIn("plain")).toBeNull();
  });
});

function fakeEditor(text: string, over: { empty?: boolean; code?: boolean; doc?: string; pos?: number } = {}) {
  return {
    state: {
      selection: { empty: over.empty ?? true, $from: { pos: over.pos ?? 1 + text.length, parentOffset: text.length, parent: { textBetween: () => text } } },
      doc: { textContent: over.doc ?? text },
    },
    isActive: () => over.code ?? false,
  } as unknown as Editor;
}

describe("mentionAtCursor", () => {
  it("finds an @login right before the cursor", () => {
    expect(mentionAtCursor(fakeEditor("@al"))).toEqual({ query: "al", from: 1, to: 4 });
    expect(mentionAtCursor(fakeEditor("ask @bob"))).toEqual({ query: "bob", from: 5, to: 9 });
    expect(mentionAtCursor(fakeEditor("@"))).toEqual({ query: "", from: 1, to: 2 });
  });

  it("finds nothing mid-word, with a selection, in a code block, or in a ! command", () => {
    expect(mentionAtCursor(fakeEditor("a@b"))).toBeNull();
    expect(mentionAtCursor(fakeEditor("@al", { empty: false }))).toBeNull();
    expect(mentionAtCursor(fakeEditor("@al", { code: true }))).toBeNull();
    expect(mentionAtCursor(fakeEditor("@al", { doc: "  !echo @al" }))).toBeNull();
    expect(mentionAtCursor(fakeEditor("plain"))).toBeNull();
  });
});
