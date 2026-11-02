import { describe, expect, it } from "vitest";
import { followUrl, showMinis as oldestFirst, pageLabel, plain, turnId } from "./show-rail";
import type { ThreadItem } from "./types";

const NOW = 1_000_000_000;
const user = (text: string, at = NOW): ThreadItem => ({ kind: "user", text, at });
const say = (text: string, at = NOW): ThreadItem => ({ kind: "assistant", text, at });
const tool = (name: string, summary: string, isError = false): ThreadItem => ({ kind: "tool", id: name, name, summary, at: NOW, isError });
const result = (isError = false): ThreadItem => ({ kind: "result", text: "", isError, at: NOW });
// Most cases read newest first, the way they're easiest to check.
const showMinis = (...args: Parameters<typeof oldestFirst>) => oldestFirst(...args).reverse();
const minis = (items: ThreadItem[], live = false) => showMinis(items, { live, now: NOW });

describe("showMinis", () => {
  it("runs oldest first, like the chat", () => {
    expect(oldestFirst([user("hi"), say("hello")], { now: NOW }).map((m) => m.text)).toEqual(["hi", "hello"]);
  });

  it("lists one mini per user message and agent turn, newest first, keyed by the turn's first item", () => {
    const out = minis([user("hi"), say("hello"), result(), user("again"), say("sure"), result()]);
    expect(out.map((m) => [m.id, m.text])).toEqual([
      [turnId(4), "sure"],
      [turnId(3), "again"],
      [turnId(1), "hello"],
      [turnId(0), "hi"],
    ]);
  });

  it("paints a user message gray", () => {
    expect(minis([user("hi")])[0]!.dot).toBe("usr");
  });

  it("paints a finished turn green", () => {
    expect(minis([user("hi"), say("Done."), result()])[0]!.dot).toBe("ok");
  });

  it("paints a turn that ends in a question amber", () => {
    expect(minis([say("Which one do you want?"), result()])[0]!.dot).toBe("wait");
    expect(minis([say("Pick one.\nBOARD STATUS: column=needs_you | stage=Planning | remaining=none"), result()])[0]!.dot).toBe("wait");
    expect(minis([say("Asking"), { kind: "permission", id: "p", toolName: "AskUserQuestion", title: "Q", at: NOW }])[0]!.dot).toBe("wait");
    expect(minis([tool("Bash", "rm x"), { kind: "permission", id: "p", toolName: "Bash", title: "Run?", at: NOW }])[0]!.dot).toBe("wait");
    expect(minis([tool("Bash", "ls"), { kind: "permission", id: "p", toolName: "Bash", title: "Run?", decision: "allow", at: NOW }, result()])[0]!.dot).toBe("ok");
  });

  it("paints the live turn amber, and only the newest", () => {
    const out = minis([say("one"), result(), user("go"), say("streaming")], true);
    expect(out.map((m) => m.dot)).toEqual(["wait", "usr", "ok"]);
  });

  it("paints an error result or a turn ending on a failed tool red, not one that recovered", () => {
    expect(minis([say("x"), result(true)])[0]!.dot).toBe("err");
    expect(minis([say("x"), tool("Bash", "pnpm build", true)])[0]!.dot).toBe("err");
    expect(minis([tool("Bash", "pnpm build", true), say("fixed it"), result()])[0]!.dot).toBe("ok");
  });

  it("names a Bash-only turn by its command, cut to 24 characters", () => {
    expect(minis([tool("Bash", "pnpm test"), result()])[0]!.text).toBe("Bash · pnpm test");
    expect(minis([tool("Bash", "pnpm vitest run lib/show-rail.test.ts")])[0]!.text).toBe("Bash · pnpm vitest run lib/sho…");
  });

  it("names an Edit or Write-only turn by its file", () => {
    expect(minis([tool("Edit", "/Users/me/dev/weft/lib/foo.ts")])[0]!.text).toBe("Edit · lib/foo.ts");
    expect(minis([tool("Write", "/Users/me/dev/weft/lib/bar.ts")])[0]!.text).toBe("Write · lib/bar.ts");
  });

  it("names a Read or Grep-only turn by its file or pattern", () => {
    expect(minis([tool("Read", "/Users/me/dev/weft/lib/foo.ts")])[0]!.text).toBe("Read · lib/foo.ts");
    expect(minis([tool("Grep", "showMinis")])[0]!.text).toBe("Grep · showMinis");
    expect(minis([tool("mcp__browser__click", "x")])[0]!.text).toBe("browser click");
  });

  it("shows an image-only message as an attachment", () => {
    expect(minis([user("![shot](/tmp/a.png)")])[0]!.text).toBe("📎 attachment");
    expect(minis([user("look ![shot](/tmp/a.png)")])[0]!.text).toBe("look");
  });

  it("clamps long text with an ellipsis", () => {
    const text = minis([user("word ".repeat(40))])[0]!.text;
    expect(text).toHaveLength(90);
    expect(text.endsWith("…")).toBe(true);
  });

  it("gives a short relative time", () => {
    expect(minis([user("a", NOW - 5_000)])[0]!.time).toBe("just now");
    expect(minis([user("a", NOW - 120_000)])[0]!.time).toBe("2m");
    expect(minis([user("a", NOW - 3_600_000)])[0]!.time).toBe("1h");
  });

  it("skips edited folds, shows shell commands, and never draws a blank chip", () => {
    const out = minis([{ kind: "edited", items: [], at: NOW }, { kind: "shell", command: "ls", at: NOW }, user(""), say("")]);
    expect(out.map((m) => m.text)).toEqual(["Working…", "…", "! ls"]);
  });

  it("falls back to the result text", () => {
    expect(minis([{ kind: "result", text: "All set", isError: false, at: NOW }])[0]!.text).toBe("All set");
  });
});

describe("browser history", () => {
  const open = (url: string, at = NOW): ThreadItem => ({ kind: "tool", id: url, name: "mcp__browser__open_url", summary: url, at });

  it("puts each page the agent opened above its turn, tied to that turn", () => {
    const out = minis([user("go"), say("Opening", NOW + 1), open("http://localhost:3000/", NOW + 2), open("file:///Users/me/.weft/show/x/index.html#live", NOW + 3), result()]);
    expect(out.map((m) => [m.dot, m.text, m.turn])).toEqual([
      ["page", "x#live", "t1"],
      ["page", "localhost:3000", "t1"],
      ["ok", "Opening", undefined],
      ["usr", "go", undefined],
    ]);
    expect(out[0]!.url).toBe("file:///Users/me/.weft/show/x/index.html#live");
  });

  it("slots pages you opened by hand in by time, after the turn before them", () => {
    const out = showMinis([user("go", NOW), say("hi", NOW + 10), result(), user("next", NOW + 100)], {
      now: NOW + 200,
      visits: [
        { url: "http://a.test/one", at: NOW + 50 },
        { url: "http://a.test/two", at: NOW + 150 },
      ],
    });
    expect(out.map((m) => [m.text, m.turn])).toEqual([
      ["/two", "t3"],
      ["next", undefined],
      ["/one", "t1"],
      ["hi", undefined],
      ["go", undefined],
    ]);
  });

  it("drops a page that's already the latest one, whoever opened it", () => {
    const out = showMinis([say("a", NOW), open("http://a.test/", NOW + 1), open("http://a.test/", NOW + 2)], {
      now: NOW,
      visits: [{ url: "http://a.test/", at: NOW + 3 }, { url: "http://b.test/", at: NOW - 5 }],
    });
    expect(out.filter((m) => m.dot === "page").map((m) => [m.text, m.turn])).toEqual([
      ["a.test", "t0"],
      ["b.test", undefined],
    ]);
  });

  it("gives each turn and message the page on screen then: a turn its own last page, else the one before", () => {
    const out = showMinis(
      [user("one", NOW), say("a", NOW + 1), open("http://a.test/", NOW + 2), open("http://b.test/", NOW + 3), user("two", NOW + 10), say("b", NOW + 11), result()],
      { now: NOW, visits: [{ url: "http://c.test/", at: NOW + 12 }] },
    );
    expect(out.filter((m) => m.dot !== "page").map((m) => [m.text, m.url])).toEqual([
      ["b", "http://c.test/"],
      ["two", "http://b.test/"],
      ["a", "http://b.test/"],
      ["one", undefined],
    ]);
  });

  it("adds the page on screen as you sent a message, and sends its dot there", () => {
    const sent = (text: string, page: string, at: number): ThreadItem => ({ kind: "user", text, at, page });
    const out = showMinis([sent("one", "http://a.test/", NOW), say("a", NOW + 1), result(), sent("two", "http://a.test/", NOW + 5), say("b", NOW + 6), sent("three", "http://b.test/#s2", NOW + 9)], { now: NOW });
    expect(out.map((m) => [m.text, m.url, m.turn])).toEqual([
      ["three", "http://b.test/#s2", undefined],
      ["b.test#s2", "http://b.test/#s2", "t4"],
      // Still on screen when the turn ended, so the turn goes there too.
      ["b", "http://b.test/#s2", undefined],
      ["two", "http://a.test/", undefined],
      ["a", "http://a.test/", undefined],
      ["one", "http://a.test/", undefined],
      ["a.test", "http://a.test/", undefined],
    ]);
  });

  it("labels pages short, and leaves a url it can't parse as is", () => {
    expect(pageLabel("file:///Users/me/a%20b/page.html")).toBe("page");
    expect(pageLabel("file:///Users/me/show/rail/index.html#live")).toBe("rail#live");
    expect(pageLabel("file:///index.html")).toBe("index");
    expect(pageLabel("file:///")).toBe("");
    expect(pageLabel(`blob:sha256:${"a".repeat(64)}`)).toBe("page");
    expect(pageLabel(`blob:sha256:${"a".repeat(64)}#plan`)).toBe("page#plan");
    expect(pageLabel("https://weft.zip/docs/")).toBe("/docs");
    expect(pageLabel("http://localhost:3000/a%20b")).toBe("/a b");
    expect(pageLabel("not a url")).toBe("not a url");
  });
});

describe("followUrl", () => {
  const out = () => oldestFirst([user("go"), say("Opening", NOW + 1), open("http://a.test/", NOW + 2), result(), user("next", NOW + 3), say("Now b", NOW + 4), open("http://b.test/", NOW + 5), result()], { now: NOW });
  const open = (url: string, at: number): ThreadItem => ({ kind: "tool", id: url, name: "mcp__browser__open_url", summary: url, at });

  it("sends the pane to the page of the turn at the chat's top, or the newest page at its end", () => {
    const list = out();
    const first = list.find((m) => m.text === "Opening")!.id;
    expect(followUrl(list, first, false, "http://b.test/")).toBe("http://a.test/");
    expect(followUrl(list, first, true, "http://a.test/")).toBe("http://b.test/");
  });

  it("stays put when the pane already shows it, or the turn has no page", () => {
    const list = out();
    expect(followUrl(list, list.find((m) => m.text === "Now b")!.id, false, "http://b.test/")).toBeUndefined();
    expect(followUrl(list, "t99", false, "http://b.test/")).toBeUndefined();
    expect(followUrl(minis([user("go")]), "t0", true, "")).toBeUndefined();
  });
});

describe("plain", () => {
  it("drops markdown, code and the status line", () => {
    expect(plain("## Hi **there** [link](http://x)\n```\ncode\n```\nBOARD STATUS: column=done | stage=Done | remaining=none")).toBe("Hi there link");
  });
});
