// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestThreadFind, stepThreadFind } from "./find-events";
import type { ThreadPage } from "./thread-page";
import type { ThreadItem } from "./types";
import { useThreadFind, type ThreadFindOptions } from "./use-thread-find";

const user = (text: string): ThreadItem => ({ kind: "user", text, at: 0 });

let scroller: HTMLDivElement;
const scrollIntoView = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  scroller = document.createElement("div");
  document.body.append(scroller);
  Element.prototype.scrollIntoView = scrollIntoView;
  Element.prototype.animate = vi.fn();
  Range.prototype.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
});
afterEach(() => {
  cleanup();
  scroller.remove();
  vi.useRealTimers();
});

function draw(items: ThreadItem[]) {
  scroller.innerHTML = items.map((item, i) => `<div data-turn="t${i}">${"text" in item ? item.text : ""}</div>`).join("");
}

function setup(over: Partial<ThreadFindOptions> = {}, items = [user("a cat"), user("no"), user("cat cat")]) {
  draw(items);
  const page: ThreadPage = { items, start: 0, total: items.length };
  const options: ThreadFindOptions = {
    enabled: true,
    cardId: "c",
    page,
    items,
    rowKeys: items.map((_, i) => i),
    scroller: { current: scroller },
    loadOlder: vi.fn(() => Promise.resolve()),
    onJump: vi.fn(),
    ...over,
  };
  return { options, ...renderHook((props: ThreadFindOptions) => useThreadFind(props), { initialProps: options }) };
}

async function type(result: { current: ReturnType<typeof useThreadFind> }, query: string) {
  act(() => {
    requestThreadFind();
  });
  act(() => {
    result.current.setQuery(query);
  });
  await act(() => vi.advanceTimersByTimeAsync(200));
}

describe("useThreadFind", () => {
  it("stays shut when it isn't the card's own thread", () => {
    const { result } = setup({ enabled: false });
    act(() => {
    requestThreadFind();
  });
    expect(result.current.open).toBe(false);
  });

  it("opens, counts over the loaded window without a search, and lands on the newest match", async () => {
    const { result, options } = setup();
    await type(result, "cat");
    expect(result.current.count).toBe("1 of 3");
    expect(result.current.reveal).toBe(options.items[2]);
    expect(options.onJump).toHaveBeenCalled();
  });

  it("steps with Enter's step and with ⌘G's event, and only while open", async () => {
    const { result, options } = setup();
    act(() => {
      stepThreadFind(1);
    });
    await type(result, "cat");
    act(() => {
      stepThreadFind(1);
    });
    act(() => {
      stepThreadFind(1);
    });
    expect(result.current.count).toBe("3 of 3");
    expect(result.current.reveal).toBe(options.items[0]);
    act(() => {
      result.current.step(-1);
    });
    expect(result.current.count).toBe("2 of 3");
  });

  it("uses the transport's search, and falls back to the window when it fails", async () => {
    const search = vi.fn(() => Promise.resolve([{ index: 1, hits: 4 }]));
    const { result } = setup({ search });
    await type(result, "x");
    expect(search).toHaveBeenCalledWith("c", "x");
    expect(result.current.count).toBe("1 of 4");

    const failing = setup({ search: () => Promise.resolve(null) });
    await type(failing.result, "cat");
    expect(failing.result.current.count).toBe("1 of 3");
  });

  it("walks the window back to a match above it", async () => {
    const items = [user("cat")];
    const loadOlder = vi.fn(() => Promise.resolve());
    const { result } = setup({
      items,
      page: { items, start: 60, total: 61 },
      rowKeys: [0],
      search: () => Promise.resolve([{ index: 5, hits: 1 }]),
      loadOlder,
    });
    await type(result, "cat");
    expect(loadOlder).toHaveBeenCalledWith(60);
    expect(result.current.reveal).toBeNull();
  });

  it("finds the row of an item folded into a run", async () => {
    const items = [user("zz"), user("cat")];
    draw([user("cat")]);
    const { result, options } = setup({ items, rowKeys: [0], page: { items, start: 0, total: 2 } }, [user("cat")]);
    await type(result, "cat");
    expect(result.current.reveal).toBeDefined();
    expect(options.onJump).toHaveBeenCalled();
  });

  it("repaints as rows change, and scrolls again once a match's text arrives", async () => {
    const items = [user("late")];
    const onJump = vi.fn();
    const { result } = setup({ items, onJump, search: () => Promise.resolve([{ index: 0, hits: 1 }]) }, items);
    scroller.innerHTML = '<div data-turn="t0">loading</div>';
    await type(result, "late");
    expect(scrollIntoView).toHaveBeenCalled();
    onJump.mockClear();
    await act(async () => {
      scroller.querySelector("div")!.textContent = "late";
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(onJump).toHaveBeenCalledTimes(1);
  });

  it("closes clean", async () => {
    const { result } = setup();
    await type(result, "cat");
    act(() => {
      result.current.close();
    });
    expect(result.current).toMatchObject({ open: false, query: "", count: "", reveal: null });
  });
});
