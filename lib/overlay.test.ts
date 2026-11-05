// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnyLocalMenu, useAnyOverlay, useLocalMenu, useMenuCover, useMenuCoverPublisher, useOverlay } from "./overlay";

afterEach(cleanup);

describe("useOverlay and useAnyOverlay", () => {
  it("reports an overlay as up while any active one is mounted", () => {
    const any = renderHook(() => useAnyOverlay());
    expect(any.result.current).toBe(false);

    const a = renderHook(({ active }) => useOverlay(active), { initialProps: { active: true } });
    expect(any.result.current).toBe(true);
    const b = renderHook(() => useOverlay(true));

    act(() => a.unmount());
    expect(any.result.current).toBe(true);
    act(() => b.unmount());
    expect(any.result.current).toBe(false);
  });

  it("follows `active` as it flips", () => {
    const any = renderHook(() => useAnyOverlay());
    const o = renderHook(({ active }) => useOverlay(active), { initialProps: { active: false } });
    expect(any.result.current).toBe(false);
    o.rerender({ active: true });
    expect(any.result.current).toBe(true);
    o.rerender({ active: false });
    expect(any.result.current).toBe(false);
  });

  it("stops notifying a reader once it unmounts", () => {
    const any = renderHook(() => useAnyOverlay());
    any.unmount();
    const o = renderHook(() => useOverlay(true));
    o.unmount();
    expect(any.result.current).toBe(false);
  });
});

describe("useLocalMenu and useAnyLocalMenu", () => {
  it("reports a menu as up while it is open", () => {
    const any = renderHook(() => useAnyLocalMenu());
    expect(any.result.current).toBe(false);

    const menu = renderHook(({ active }) => useLocalMenu(active), { initialProps: { active: true } });
    expect(any.result.current).toBe(true);

    act(() => menu.unmount());
    expect(any.result.current).toBe(false);
  });

  it("leaves the full-window overlay counter alone", () => {
    // A dropdown in a card's header must not blank the browser pane's page.
    const overlay = renderHook(() => useAnyOverlay());
    const menu = renderHook(() => useAnyLocalMenu());
    renderHook(() => useLocalMenu(true));
    expect(menu.result.current).toBe(true);
    expect(overlay.result.current).toBe(false);
  });

  it("leaves the menu counter alone when a full-window overlay is up", () => {
    const overlay = renderHook(() => useAnyOverlay());
    const menu = renderHook(() => useAnyLocalMenu());
    renderHook(() => useOverlay(true));
    expect(overlay.result.current).toBe(true);
    expect(menu.result.current).toBe(false);
  });

  it("publishes the rectangle the open menu covers, and takes it back when it closes", () => {
    const cover = renderHook(() => useMenuCover());
    expect(cover.result.current).toBeNull();

    const box = { x: 976, y: 140, width: 224, height: 320 };
    const menu = document.createElement("div");
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({ left: 976, top: 140, width: 224, height: 320 } as DOMRect);
    const ref = { current: menu };
    const publisher = renderHook(({ active }) => useMenuCoverPublisher(ref, active), { initialProps: { active: true } });
    expect(cover.result.current).toEqual(box);

    act(() => publisher.unmount());
    expect(cover.result.current).toBeNull();
  });
});
