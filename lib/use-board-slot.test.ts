// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { originOf, slotFor, useBoardSlot } from "./use-board-slot";

afterEach(() => document.body.replaceChildren());

const rect = (r: Partial<DOMRect>) => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => r, ...r });

describe("useBoardSlot", () => {
  it("puts the card right of the sidebar, its height, out to the window's edge, less the frame's origin", () => {
    expect(slotFor(rect({ right: 318.4, top: 100, height: 660 }), 1280)).toEqual({ left: 318, top: 100, width: 962, height: 660 });
    expect(slotFor(rect({ right: 320, top: 100, height: 660 }), 1280, { x: 40, y: 0 })).toMatchObject({ left: 280, top: 100 });
    expect(slotFor(rect({ right: 1400, height: -5 }), 1280)).toMatchObject({ width: 0, height: 0 });
  });

  it("reads a frame's origin from where it lands against the left and top it was given", () => {
    expect(originOf(null)).toEqual({ x: 0, y: 0 });
    const frame = document.createElement("div");
    frame.style.left = "280px";
    frame.style.top = "100px";
    frame.getBoundingClientRect = () => rect({ left: 320, top: 100 });
    expect(originOf(frame)).toEqual({ x: 40, y: 0 });
    frame.style.left = "";
    frame.style.top = "";
    expect(originOf(frame)).toEqual({ x: 320, y: 100 });
  });

  it("measures the board's sidebar and follows a resize, and is null when off or with no sidebar", () => {
    expect(renderHook(() => useBoardSlot(true)).result.current.slot).toBeNull();
    expect(renderHook(() => useBoardSlot(false)).result.current.slot).toBeNull();
    const rail = document.createElement("div");
    const sidebar = document.createElement("nav");
    sidebar.setAttribute("data-board-sidebar", "");
    document.body.append(rail, sidebar);
    let box = rect({ right: 300, top: 100, height: 600 });
    sidebar.getBoundingClientRect = () => box;
    const { result, unmount } = renderHook(() => useBoardSlot(true));
    expect(result.current.slot).toEqual({ left: 300, top: 100, width: window.innerWidth - 300, height: 600 });
    const first = result.current.slot;
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(result.current.slot).toBe(first);
    box = rect({ right: 340, top: 100, height: 550 });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(result.current.slot).toMatchObject({ left: 340, height: 550 });
    unmount();
  });
});
