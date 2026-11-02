// @vitest-environment jsdom
// What a worker card's thread view drew, for the show rail beside it (lib/worker-shown.ts).
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "./types";
import { clearShown, useShownItems, useWorkerShown } from "./worker-shown";

const item = (text: string): ThreadItem => ({ kind: "user", text, at: 0 });

describe("worker-shown", () => {
  it("hands what the view draws to the rail, and forgets it when the card closes", () => {
    const rail = renderHook(() => useWorkerShown());
    expect(rail.result.current).toEqual([]);
    const items = [item("one")];
    const view = renderHook(({ list }) => useShownItems(list), { initialProps: { list: items } });
    expect(view.result.current).toBe(items);
    expect(rail.result.current).toBe(items);
    // The same list again changes nothing.
    view.rerender({ list: items });
    expect(rail.result.current).toBe(items);
    const more = [item("one"), item("two")];
    view.rerender({ list: more });
    expect(rail.result.current).toBe(more);
    act(() => clearShown());
    expect(rail.result.current).toEqual([]);
    rail.unmount();
    view.unmount();
  });

  it("draws nothing on the server", () => {
    function Count() {
      return createElement("span", null, useWorkerShown().length);
    }
    expect(renderToString(createElement(Count))).toBe("<span>0</span>");
  });
});
