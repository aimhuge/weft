import { describe, expect, it } from "vitest";
import { findableText, findCount, matchThread, plainMarkdown, spotAt, totalHits } from "./thread-find";
import type { ThreadItem } from "./types";

const user = (text: string): ThreadItem => ({ kind: "user", text, at: 0 });
const tool = (over: object = {}): ThreadItem => ({ kind: "tool", id: "t", name: "Bash", summary: "ls", at: 0, ...over });

describe("plainMarkdown", () => {
  it("reads markdown as it shows", () => {
    expect(plainMarkdown("foo **bar** `baz` [link](http://x) ![pic](y)")).toBe("foo bar baz link pic");
  });
});

describe("findableText", () => {
  it("covers what folds away, and leaves out plain markers", () => {
    expect(findableText(tool({ result: "out", edit: { lines: [{ kind: "+", text: "added" }], more: 0 } }))).toBe("Bash\nls\nout\nadded");
    expect(findableText({ kind: "permission", id: "p", toolName: "Bash", title: "Run it?", answer: "yes", at: 0 })).toBe("Run it?\nyes");
    expect(findableText({ kind: "result", text: "boom", isError: true, at: 0 })).toBe("boom");
    expect(findableText({ kind: "result", text: "done", isError: false, at: 0 })).toBe("");
    expect(findableText({ kind: "notification", status: "failed", summary: "task", at: 0 })).toBe("task");
    expect(findableText({ kind: "spliced", brief: "**brief**", at: 0 })).toBe("brief");
    expect(findableText({ kind: "edited", items: [user("old"), tool()], at: 0 })).toBe("old\nBash\nls");
    expect(findableText({ kind: "shell", command: "pwd", output: "/x", at: 0 })).toBe("pwd\n/x");
    expect(findableText({ kind: "assistant", text: "`hi`", at: 0 })).toBe("hi");
  });
});

describe("matchThread", () => {
  it("counts occurrences per item, ignoring case and skipping holes, at absolute indexes", () => {
    expect(matchThread([user("Cat cat"), null, undefined, user("dog"), user("CAT")], "cat", 10)).toEqual([
      { index: 10, hits: 2 },
      { index: 14, hits: 1 },
    ]);
  });

  it("matches nothing for an empty query and doesn't overlap", () => {
    expect(matchThread([user("x")], "")).toEqual([]);
    expect(matchThread([user("aaa")], "aa")).toEqual([{ index: 0, hits: 1 }]);
  });
});

describe("spotAt", () => {
  const matches = [
    { index: 2, hits: 1 },
    { index: 7, hits: 2 },
  ];

  it("starts at the newest occurrence and walks back up the thread", () => {
    expect(spotAt(matches, 0)).toEqual({ index: 7, nth: 1 });
    expect(spotAt(matches, 1)).toEqual({ index: 7, nth: 0 });
    expect(spotAt(matches, 2)).toEqual({ index: 2, nth: 0 });
  });

  it("wraps past either end", () => {
    expect(spotAt(matches, 3)).toEqual({ index: 7, nth: 1 });
    expect(spotAt(matches, -1)).toEqual({ index: 2, nth: 0 });
  });

  it("has no spot without matches", () => {
    expect(spotAt([], 0)).toBeUndefined();
    expect(totalHits(matches)).toBe(3);
  });
});

describe("findCount", () => {
  it("reads empty, searching, none and where you are", () => {
    expect(findCount("", null, 0)).toBe("");
    expect(findCount("x", null, 0)).toBe("…");
    expect(findCount("x", [], 0)).toBe("0 of 0");
    expect(findCount("x", [{ index: 0, hits: 3 }], 4)).toBe("2 of 3");
    expect(findCount("x", [{ index: 0, hits: 3 }], -1)).toBe("3 of 3");
  });
});
