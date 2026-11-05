import { describe, expect, it } from "vitest";
import { SEALED_TEXT } from "./sync-seal";
import { awayText, importedItem, importedItems, TAKEOVER_ITEMS_MAX, takeoverBrief, takeoverMessage } from "./team-takeover-brief";
import type { ThreadItem } from "./types";

const sha = "ab".repeat(32);

describe("awayText", () => {
  it("says a blob picture and any other blob ref stayed on their Mac", () => {
    expect(awayText(`see ![the board](blob:sha256:${sha}) and blob:sha256:${sha}`, "Zulker")).toBe("see (the board: a picture on Zulker's Mac) and (a file on Zulker's Mac)");
    expect(awayText(`![](blob:sha256:${sha})`, "Zulker")).toBe("(a picture on Zulker's Mac)");
    expect(awayText("plain", "Zulker")).toBe("plain");
  });
});

describe("importedItem", () => {
  it("drops a permission and a row that stayed sealed", () => {
    expect(importedItem({ kind: "permission", at: 1 } as ThreadItem, "Z")).toBeNull();
    expect(importedItem({ kind: "assistant", text: SEALED_TEXT, at: 1 }, "Z")).toBeNull();
  });

  it("keeps a user's words without their prompt id or page", () => {
    expect(importedItem({ kind: "user", text: "go", at: 1, id: "p1", page: "/x.html", midTurn: true }, "Z")).toEqual({ kind: "user", text: "go", at: 1 });
  });

  it("rewrites the agent's blob refs", () => {
    expect(importedItem({ kind: "assistant", text: `![a](blob:sha256:${sha})`, at: 2 }, "Z")).toEqual({ kind: "assistant", text: "(a: a picture on Z's Mac)", at: 2 });
  });

  it("drops a tool's pictures and says where a cut output stayed", () => {
    const tool = { kind: "tool", id: "t", name: "Bash", summary: "ls", images: ["blob:x"], resultBytes: 9000, at: 3 } as unknown as ThreadItem;
    expect(importedItem(tool, "Z")).toEqual({ kind: "tool", id: "t", name: "Bash", summary: "ls", result: "(The full output stayed on Z's Mac.)", at: 3 });
    const whole = { kind: "tool", id: "t", name: "Bash", summary: "ls", result: "a.txt", at: 3 } as unknown as ThreadItem;
    expect(importedItem(whole, "Z")).toEqual(whole);
  });

  it("keeps the other kinds as they are", () => {
    const result: ThreadItem = { kind: "result", text: "done", isError: false, at: 4 };
    expect(importedItem(result, "Z")).toBe(result);
  });
});

describe("importedItems", () => {
  it("keeps the newest items up to the cap", () => {
    const items: ThreadItem[] = Array.from({ length: TAKEOVER_ITEMS_MAX + 5 }, (_, i) => ({ kind: "assistant", text: `m${i}`, at: i }));
    const out = importedItems(items, "Z");
    expect(out).toHaveLength(TAKEOVER_ITEMS_MAX);
    expect(out[0]).toMatchObject({ text: "m5" });
  });

  it("leaves out the items with no place here", () => {
    expect(importedItems([{ kind: "permission", at: 1 } as ThreadItem, { kind: "assistant", text: "ok", at: 2 }], "Z")).toEqual([{ kind: "assistant", text: "ok", at: 2 }]);
  });
});

describe("takeoverMessage", () => {
  it("names the card and what was left open", () => {
    expect(takeoverMessage({ title: "Fix login", remaining: "tests" }, "Zulker")).toBe('Take over Zulker\'s card "Fix login" and carry on from where it stands. Still open: tests.');
    expect(takeoverMessage({ title: "Fix login", remaining: "none" }, "Zulker")).toBe('Take over Zulker\'s card "Fix login" and carry on from where it stands.');
    expect(takeoverMessage({ title: "Fix login" }, "Zulker", { branch: "weft/handover/a" })).toBe('Take over Zulker\'s card "Fix login", which they handed over on `weft/handover/a`, and carry on from where it stands.');
  });
});

describe("takeoverBrief", () => {
  const file = (f: string) => ({ file: f, edits: 1, added: 1, removed: 0, symbols: [] });

  it("wraps the summary, what's open, their files under the repo and where their edits are", () => {
    const brief = takeoverBrief({ title: "Fix login", remaining: "tests", cwd: "/Users/z/code/app" }, "Zulker", "acme/app", " The summary. ", [file("/Users/z/code/app/lib/a.ts"), file("/elsewhere/b.ts")]);
    expect(brief.startsWith("<system-reminder>\nThis card continues Zulker's card \"Fix login\"")).toBe(true);
    expect(brief).toContain("checkout of acme/app");
    expect(brief).toContain("\n\nThe summary.\n");
    expect(brief).toContain("Still open, from its last status line: tests");
    expect(brief).toContain("Files it changed on Zulker's Mac:\n- lib/a.ts\n- /elsewhere/b.ts");
    expect(brief).toContain("`git fetch`");
    expect(brief.endsWith("</system-reminder>\n\n")).toBe(true);
  });

  it("points at the branch their Mac pushed when they handed it over", () => {
    const brief = takeoverBrief({ title: "T", cwd: "" }, "Zulker", "acme/app", "S", [], { branch: "weft/handover/abc", sha: "0123456789abcdef" });
    expect(brief).toContain("Zulker handed this over");
    expect(brief).toContain("`weft/handover/abc` at `0123456789ab`");
    expect(brief).toContain("`git fetch origin weft/handover/abc`");
    expect(brief).not.toContain("did not come along");
    expect(takeoverBrief({ title: "T", cwd: "" }, "Z", "a/b", "S", [], { branch: "b" })).not.toContain(" at `");
  });

  it("leaves out what it doesn't have", () => {
    const brief = takeoverBrief({ title: "T", cwd: "" }, "Zulker", "acme/app", "S", []);
    expect(brief).not.toContain("Still open");
    expect(brief).not.toContain("Files it changed");
  });
});
