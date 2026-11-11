import { describe, expect, it } from "vitest";
import { replyPlaceholder } from "./reply-placeholder";

describe("replyPlaceholder", () => {
  it("shows the question line when a question is open", () => {
    expect(replyPlaceholder(false, undefined, "Reply…", true)).toMatch(/own answer/);
  });

  it("shows the working line when a turn is running", () => {
    expect(replyPlaceholder(true, "run tests", "Reply…", false)).toBe("Write the next message: @ mentions, / skills");
  });

  it("shows the suggestion with the Tab cue when idle and a suggestion is given", () => {
    expect(replyPlaceholder(false, "run tests", "Reply…", false)).toBe("run tests  ⇥ Tab");
  });

  it("falls back to the plain placeholder when nothing else applies", () => {
    expect(replyPlaceholder(false, undefined, "Reply…", false)).toBe("Reply…");
  });
});