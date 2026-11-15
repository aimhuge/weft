import { describe, expect, it } from "vitest";
import { lastSentence, paneLiveLine, stepLine } from "./pane-live-line";
import type { ThreadItem } from "./types";

const user = (text: string, at = 1): ThreadItem => ({ kind: "user", text, at });
const said = (text: string, at = 2): ThreadItem => ({ kind: "assistant", text, at });
const tool = (name: string, summary: string, at = 3): ThreadItem => ({ kind: "tool", id: `t${at}`, name, summary, at });

describe("stepLine", () => {
  it("names the tool and what it touched", () => {
    expect(stepLine(tool("Edit", " lib/foo.ts ") as Extract<ThreadItem, { kind: "tool" }>)).toBe("Edit · lib/foo.ts");
  });
  it("shortens an MCP tool's name and stands alone with no summary", () => {
    expect(stepLine(tool("mcp__browser__snapshot", "") as Extract<ThreadItem, { kind: "tool" }>)).toBe("browser snapshot");
  });
});

describe("lastSentence", () => {
  it("keeps the last sentence in plain words", () => {
    expect(lastSentence("I built it. **Want** a test?")).toBe("Want a test?");
  });
  it("is empty for a reply with no words", () => {
    expect(lastSentence("```\ncode\n```")).toBe("");
  });
});

describe("paneLiveLine", () => {
  it("is null for an empty thread", () => {
    expect(paneLiveLine([])).toBeNull();
  });

  it("shows the newest step while a turn runs", () => {
    const line = paneLiveLine([user("go"), said("On it."), tool("Edit", "lib/foo.ts")], { live: true, now: 10 });
    expect(line).toEqual({ dot: "wait", text: "Edit · lib/foo.ts" });
  });

  it("shows the last sentence once the turn ends", () => {
    const line = paneLiveLine([user("go"), tool("Bash", "pnpm test"), said("Tests pass. Ready for review.", 4)], { now: 10 });
    expect(line).toEqual({ dot: "ok", text: "Ready for review." });
  });

  it("says Working… while a turn has nothing to show yet", () => {
    expect(paneLiveLine([said("Earlier."), user("again")], { live: true, now: 10 })).toEqual({ dot: "usr", text: "Working…" });
  });

  it("falls back to the newest mini's own words", () => {
    expect(paneLiveLine([user("Hello there")], { now: 10 })).toEqual({ dot: "usr", text: "Hello there" });
  });

  it("reads only the newest turn, skipping edits and pages", () => {
    const items: ThreadItem[] = [
      said("Old news."),
      { kind: "shell", command: "ls", at: 3 },
      { kind: "edited", items: [], at: 4 },
      tool("mcp__browser__open_url", "https://example.com/plan", 5),
      said("New page is up.", 6),
    ];
    expect(paneLiveLine(items, { now: 10 })).toEqual({ dot: "ok", text: "New page is up." });
  });

  it("clips a long sentence", () => {
    const line = paneLiveLine([user("go"), said(`${"word ".repeat(60)}end.`)], { now: 10 });
    expect(line?.text).toHaveLength(120);
    expect(line?.text.endsWith("…")).toBe(true);
  });

  it("reads a paged thread with holes before its loaded page", () => {
    const sparse: ThreadItem[] = [];
    sparse[5] = { kind: "user", text: "Fix it", at: 1 };
    sparse[6] = { kind: "assistant", text: "Done. It works now.", at: 2 };
    expect(paneLiveLine(sparse)?.text).toBe("It works now.");
  });
});
