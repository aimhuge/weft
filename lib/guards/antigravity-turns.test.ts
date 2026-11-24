import { describe, expect, it } from "vitest";
import { antigravityToken, bindConversation, noteForModel, takeNotes } from "./antigravity-turns";

// Which Antigravity conversation is which turn's guards (lib/guards/antigravity-turns.ts).

describe("bindConversation and antigravityToken", () => {
  it("finds a bound conversation's token from a hook payload, until it's unbound", () => {
    const unbind = bindConversation("C1", "tok-1");
    expect(antigravityToken({ conversationId: "C1", hookEventName: "PreToolUse" })).toBe("tok-1");
    unbind();
    expect(antigravityToken({ conversationId: "C1" })).toBeUndefined();
  });

  it("leaves a newer binding of the same conversation in place when an older one unbinds", () => {
    const older = bindConversation("C2", "tok-old");
    const newer = bindConversation("C2", "tok-new");
    older();
    expect(antigravityToken({ conversationId: "C2" })).toBe("tok-new");
    newer();
    expect(antigravityToken({ conversationId: "C2" })).toBeUndefined();
  });

  it("is undefined for a payload that isn't an object, has no string id, or names a conversation Weft didn't start", () => {
    expect(antigravityToken(undefined)).toBeUndefined();
    expect(antigravityToken("C1")).toBeUndefined();
    expect(antigravityToken({ conversationId: 5 })).toBeUndefined();
    expect(antigravityToken({ conversationId: "never" })).toBeUndefined();
  });

  it("keeps its map on globalThis, so the route's own copy of the module sees it", () => {
    const unbind = bindConversation("C3", "tok-3");
    expect((globalThis as unknown as { __weftAntigravityGuards: Map<string, string> }).__weftAntigravityGuards.get("C3")).toBe("tok-3");
    unbind();
  });
});

describe("noteForModel and takeNotes", () => {
  const step = (systemMessage: string) => ({ injectSteps: [{ systemMessage: { systemMessage } }] });

  it("hands a bound conversation's notes to its next model call as one system message, once", () => {
    const unbind = bindConversation("N1", "tok");
    noteForModel({ conversationId: "N1" }, "Broke an import.");
    noteForModel({ conversationId: "N1" }, "Fix it.");
    // Exactly this shape, with no metadata: agy 1.5.16 ignores a step that has any.
    expect(takeNotes({ conversationId: "N1", hookEventName: "PreInvocation" })).toEqual(step("Broke an import.\n\nFix it."));
    expect(takeNotes({ conversationId: "N1" })).toEqual({});
    noteForModel({ conversationId: "N1" }, "Again.");
    expect(takeNotes({ conversationId: "N1" })).toEqual(step("Again."));
    unbind();
  });

  it("keeps each conversation's notes apart", () => {
    const a = bindConversation("N2", "tok-a");
    const b = bindConversation("N3", "tok-b");
    noteForModel({ conversationId: "N2" }, "for a");
    expect(takeNotes({ conversationId: "N3" })).toEqual({});
    expect(takeNotes({ conversationId: "N2" })).toEqual(step("for a"));
    a();
    b();
  });

  it("ignores blank text and a conversation Weft didn't start", () => {
    const unbind = bindConversation("N4", "tok");
    noteForModel({ conversationId: "N4" }, "");
    noteForModel({ conversationId: "N4" }, "  \n ");
    expect(takeNotes({ conversationId: "N4" })).toEqual({});
    noteForModel({ conversationId: "stranger" }, "x");
    expect(takeNotes({ conversationId: "stranger" })).toEqual({});
    for (const payload of [undefined, null, "N4", { conversationId: 4 }]) {
      noteForModel(payload, "x");
      expect(takeNotes(payload)).toEqual({});
    }
    expect(takeNotes({ conversationId: "N4" })).toEqual({});
    unbind();
  });

  it("drops a conversation's notes when its guards close, and keeps them when a stale binding unbinds", () => {
    const older = bindConversation("N5", "tok-old");
    const newer = bindConversation("N5", "tok-new");
    noteForModel({ conversationId: "N5" }, "kept");
    older();
    expect(takeNotes({ conversationId: "N5" })).toEqual(step("kept"));
    noteForModel({ conversationId: "N5" }, "dropped");
    newer();
    const again = bindConversation("N5", "tok-again");
    expect(takeNotes({ conversationId: "N5" })).toEqual({});
    again();
  });

  it("keeps its notes on globalThis, so the route's own copy of the module sees them", () => {
    const unbind = bindConversation("N6", "tok");
    noteForModel({ conversationId: "N6" }, "hi");
    expect((globalThis as unknown as { __weftAntigravityNotes: Map<string, string[]> }).__weftAntigravityNotes.get("N6")).toEqual(["hi"]);
    unbind();
  });
});
