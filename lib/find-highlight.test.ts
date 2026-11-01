// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearFindHighlights, paintFindHighlights, rangesIn, scrollToRange } from "./find-highlight";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function dom(html: string) {
  document.body.innerHTML = html;
  return document.body;
}

class Paint {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

describe("rangesIn", () => {
  it("finds every occurrence, ignoring case", () => {
    expect(rangesIn(dom("<p>Cat cat</p>"), "cat").map(String)).toEqual(["Cat", "cat"]);
  });

  it("keeps a match that crosses inline formatting whole", () => {
    expect(rangesIn(dom("<p>foo <b>bar</b> baz</p>"), "foo bar b").map(String)).toEqual(["foo bar b"]);
  });

  it("skips a closed fold's body but not its summary", () => {
    const html = "<details><summary>cat</summary><p>cat</p></details>";
    expect(rangesIn(dom(html), "cat")).toHaveLength(1);
    expect(rangesIn(dom(html.replace("<details>", "<details open>")), "cat")).toHaveLength(2);
  });

  it("finds nothing for an empty query", () => {
    expect(rangesIn(dom("<p>x</p>"), "")).toEqual([]);
  });
});

describe("paintFindHighlights", () => {
  const rows = '<div id="s"><div data-turn="t0" id="a">cat</div><div data-turn="t1" id="b">cat and cat</div></div>';

  it("paints every match and the current one", () => {
    const set = vi.fn();
    const del = vi.fn();
    vi.stubGlobal("Highlight", Paint);
    vi.stubGlobal("CSS", { highlights: { set, delete: del } });
    dom(rows);
    const now = paintFindHighlights(document.querySelector("#s")!, "cat", document.querySelector("#b"), 1);
    expect(now?.startOffset).toBe(8);
    const painted = set.mock.calls as [string, Paint][];
    expect(painted.map(([name, paint]) => [name, paint.ranges.length])).toEqual([["thread-find", 3], ["thread-find-now", 1]]);
  });

  it("takes the row's last when it draws fewer than the data holds, and clears with no current", () => {
    const set = vi.fn();
    const del = vi.fn();
    vi.stubGlobal("Highlight", Paint);
    vi.stubGlobal("CSS", { highlights: { set, delete: del } });
    dom(rows);
    expect(paintFindHighlights(document.querySelector("#s")!, "cat", document.querySelector("#a"), 5)?.startOffset).toBe(0);
    expect(paintFindHighlights(document.querySelector("#s")!, "cat", null, 0)).toBeNull();
    expect(del).toHaveBeenCalledWith("thread-find-now");
    clearFindHighlights();
    expect(del).toHaveBeenCalledWith("thread-find");
  });

  it("still returns the range where the browser has no highlights", () => {
    dom(rows);
    expect(paintFindHighlights(document.querySelector("#s")!, "cat", document.querySelector("#a"), 0)).not.toBeNull();
    expect(() => clearFindHighlights()).not.toThrow();
  });
});

describe("scrollToRange", () => {
  it("scrolls the element in, then centres the match itself", () => {
    const scroller = dom('<div id="s"><p id="p">cat</p></div>').querySelector<HTMLElement>("#s")!;
    const p = scroller.querySelector("p")!;
    const scrollIntoView = vi.fn();
    p.scrollIntoView = scrollIntoView;
    scroller.getBoundingClientRect = () => ({ top: 100, height: 200 }) as DOMRect;
    const range = { startContainer: p.firstChild, getBoundingClientRect: () => ({ top: 500 }) } as unknown as Range;
    scrollToRange(scroller, range);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(scroller.scrollTop).toBe(300);
  });
});
