// A worker card's pane column given a page to open (lib/worker-page-pick.ts): a path the card opened goes to the blob
// its worker uploaded, any other page only the worker has opens nothing, and what this Mac can show goes through.
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "./types";
import { workerPagePick } from "./worker-page-pick";

const A = `blob:sha256:${"a".repeat(64)}`;
const B = `blob:sha256:${"b".repeat(64)}`;
const SHOW = "/home/me/.weft-worker/data/show";

const opened = (summary: string, result: string | undefined, at = 1): ThreadItem => ({ kind: "tool", id: `t${at}`, name: "mcp__browser__open_url", summary, at, ...(result === undefined ? {} : { result }) });

describe("workerPagePick", () => {
  it("trades a path the card opened for the blob its worker uploaded, as an old worker words it", () => {
    const items = [opened(A, `Opened ${SHOW}/todos.html — Your todos. It's in the pane on the user's board.`)];
    expect(workerPagePick(`${SHOW}/todos.html`, items)).toBe(A);
  });

  it("takes the newest upload of the page, and the anchor the caller asked for", () => {
    const items = [opened(A, `Opened ${SHOW}/plan.html — Plan.`, 1), opened(B, `Opened file://${SHOW}/plan.html#old — Plan.`, 2)];
    expect(workerPagePick(`file://${SHOW}/plan.html#step-2`, items)).toBe(`${B}#step-2`);
  });

  it("matches a path with spaces however it was written", () => {
    const items = [opened(A, `Opened file://${SHOW}/my%20page.html — Mine.`)];
    expect(workerPagePick(`${SHOW}/my page.html`, items)).toBe(A);
  });

  it("opens nothing for a page only the worker has, so the pane keeps the card's page", () => {
    const items = [opened(A, `Opened ${SHOW}/other.html — Other.`), opened(`${SHOW}/kept.html`, `Opened ${SHOW}/kept.html — Kept.`), opened(B, undefined), opened(B, `Can't show ${SHOW}/todos.html`)];
    expect(workerPagePick(`${SHOW}/todos.html`, items)).toBeNull();
    expect(workerPagePick(`${SHOW}/kept.html`, items)).toBeNull();
    expect(workerPagePick("http://localhost:3000/", items)).toBeNull();
  });

  it("only reads the card's own open_url calls", () => {
    const other: ThreadItem = { kind: "tool", id: "x", name: "Read", summary: A, result: `Opened ${SHOW}/todos.html`, at: 1 };
    const said: ThreadItem = { kind: "assistant", text: `Opened ${SHOW}/todos.html`, at: 2 };
    expect(workerPagePick(`${SHOW}/todos.html`, [other, said])).toBeNull();
  });

  it("passes a blob, a site or a live screen through as it is, and drops what isn't a page", () => {
    expect(workerPagePick(`${A}#x`, [])).toBe(`${A}#x`);
    expect(workerPagePick("https://example.com/a", [])).toBe("https://example.com/a");
    const screen = `weft-screen:${"0".repeat(32)}?device=d1&name=Phone&until=9`;
    expect(workerPagePick(screen, [])).toBe(screen);
    expect(workerPagePick("  ", [])).toBeNull();
    expect(workerPagePick("todos.html", [])).toBeNull();
  });

  it("keeps a path that isn't valid URI escaping as it is", () => {
    const items = [opened(A, `Opened ${SHOW}/100%.html — Full.`)];
    expect(workerPagePick(`${SHOW}/100%.html`, items)).toBe(A);
  });
});
