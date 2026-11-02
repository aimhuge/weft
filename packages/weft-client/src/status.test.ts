import { describe, expect, it } from "vitest";
import { extractStatus } from "./status";

describe("extractStatus", () => {
  it("reads a valid line and strips it from the text", () => {
    const { text, status } = extractStatus(
      "All done.\n\nBOARD STATUS: column=review | stage=First shot | remaining=add a test, commit",
    );
    expect(status).toEqual({ column: "review", stage: "First shot", remaining: "add a test, commit" });
    expect(text).toBe("All done.");
  });

  it("returns no status and the text untouched when there is no line", () => {
    expect(extractStatus("Just a reply.\n")).toEqual({ text: "Just a reply.", status: undefined });
  });

  it("tolerates extra whitespace, case and markdown wrapping", () => {
    const line = "  > **BOARD STATUS:   column = Needs-You |  stage = Planning  |remaining=  a decision  **";
    const { status } = extractStatus(`hi\n${line}`);
    expect(status).toEqual({ column: "needs_you", stage: "Planning", remaining: "a decision" });
    expect(extractStatus("`board status: column=done | stage=Done | remaining=none`").status).toEqual({
      column: "done",
      stage: "Done",
      remaining: undefined,
    });
  });

  it("treats remaining=none as nothing left", () => {
    expect(extractStatus("BOARD STATUS: column=done | stage=Done | remaining=None.").status?.remaining).toBeUndefined();
  });

  it("accepts a line with only a column", () => {
    expect(extractStatus("BOARD STATUS: column=review").status).toEqual({
      column: "review",
      stage: undefined,
      remaining: undefined,
    });
  });

  it("ignores an unknown or missing column but still strips the line", () => {
    for (const line of ["BOARD STATUS: column=running | stage=X", "BOARD STATUS: stage=Planning", "BOARD STATUS: nonsense"]) {
      const result = extractStatus(`text\n${line}`);
      expect(result.status).toBeUndefined();
      expect(result.text).toBe("text");
    }
  });

  it("keeps an unknown stage as written", () => {
    expect(extractStatus("BOARD STATUS: column=review | stage=Whatever").status?.stage).toBe("Whatever");
  });

  it("uses the last valid line when there are several", () => {
    const { text, status } = extractStatus(
      "a\nBOARD STATUS: column=needs_you | stage=Planning\nb\nBOARD STATUS: column=done | stage=Done | remaining=none",
    );
    expect(status?.column).toBe("done");
    expect(text).toBe("a\nb");
  });

  it("keeps an earlier valid status when a later line is invalid", () => {
    const { status } = extractStatus("BOARD STATUS: column=review\nBOARD STATUS: column=bogus");
    expect(status?.column).toBe("review");
  });

  it("ignores a mid-sentence mention", () => {
    const text = "I end replies with a BOARD STATUS: column=review line.";
    expect(extractStatus(text)).toEqual({ text, status: undefined });
  });

  it("reads a line where only the label is bold", () => {
    const { text, status } = extractStatus("hi\n**BOARD STATUS:** column=review | stage=Polishing | remaining=none");
    expect(status).toEqual({ column: "review", stage: "Polishing", remaining: undefined });
    expect(text).toBe("hi");
    expect(extractStatus("**BOARD STATUS**: column=done | stage=Done").status?.column).toBe("done");
  });

  it("reads a fully bold line with a bold label inside", () => {
    expect(extractStatus("**BOARD STATUS:** column=needs_you | stage=Planning**").status).toEqual({
      column: "needs_you",
      stage: "Planning",
      remaining: undefined,
    });
  });

  it("does not act on a status line quoted inside a code block", () => {
    const reply = "Example:\n```\nBOARD STATUS: column=done | stage=Done | remaining=none\n```\nBOARD STATUS: column=review | stage=Polishing";
    const { text, status } = extractStatus(reply);
    expect(text).toBe("Example:\n```\nBOARD STATUS: column=done | stage=Done | remaining=none\n```");
    expect(status?.column).toBe("review");
  });

  it("reads no status when the only line is inside a code block", () => {
    const reply = "Like this:\n~~~text\nBOARD STATUS: column=done\n~~~";
    expect(extractStatus(reply)).toEqual({ text: reply, status: undefined });
  });

  it("only closes a fence on a matching marker", () => {
    // A shorter or different fence inside the block doesn't end it.
    const reply = "````md\n```\nBOARD STATUS: column=done\n```\n````\nBOARD STATUS: column=review";
    const { status, text } = extractStatus(reply);
    expect(status?.column).toBe("review");
    expect(text).toContain("BOARD STATUS: column=done");
  });

  it("still reads the line after a fence that never closes", () => {
    expect(extractStatus("```\nsome code\nBOARD STATUS: column=review").status?.column).toBe("review");
  });

  it("folds the blank lines the removed line leaves behind", () => {
    expect(extractStatus("a\n\nBOARD STATUS: column=review\n\nb").text).toBe("a\n\nb");
  });
});
