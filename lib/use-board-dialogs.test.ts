// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LoginView } from "./types";

import { dialogLayers, useBoardDialogs, type DialogFlags } from "./use-board-dialogs";

afterEach(cleanup);

const OFF: DialogFlags = {
  showNew: false,
  showSettings: false,
  showHelp: false,
  showPalette: false,
  login: null,
  menuOpen: false,
};

const LOGIN = { backend: "claude", state: "running" } as unknown as LoginView;

describe("dialogLayers", () => {
  it("puts nothing over the board when every flag is off", () => {
    expect(dialogLayers(OFF)).toEqual({ overlay: false, boardKeys: true });
  });

  it.each([
    ["showSettings", true],
    ["showHelp", true],
    ["showPalette", true],
    ["menuOpen", true],
    ["changelog", true],
    ["intake", true],
  ] as const)("%s alone is an overlay that stands the board's keys down", (flag, on) => {
    expect(dialogLayers({ ...OFF, [flag]: on })).toEqual({ overlay: true, boardKeys: false });
  });

  it("a sign-in is an overlay too, however it got there", () => {
    expect(dialogLayers({ ...OFF, login: LOGIN })).toEqual({ overlay: true, boardKeys: false });
  });

  it("New thread stands the keys down without covering the pane", () => {
    expect(dialogLayers({ ...OFF, showNew: true })).toEqual({ overlay: false, boardKeys: false });
  });

  it("several flags together stay an overlay", () => {
    expect(dialogLayers({ ...OFF, showNew: true, showHelp: true, login: LOGIN })).toEqual({
      overlay: true,
      boardKeys: false,
    });
  });
});

describe("useBoardDialogs", () => {
  it("starts with everything closed and the board's own keys live", () => {
    const { result } = renderHook(() => useBoardDialogs());
    expect(result.current.showNew).toBe(false);
    expect(result.current.menuOpen).toBe(false);
    expect(result.current.showSettings).toBe(false);
    expect(result.current.sharingBoard).toBe(false);
    expect(result.current.showHelp).toBe(false);
    expect(result.current.showPalette).toBe(false);
    expect(result.current.paletteQuery).toBe("");
    expect(result.current.login).toBeNull();
    expect(result.current.overlay).toBe(false);
    expect(result.current.boardKeys).toBe(true);
  });

  it("opens and closes each dialog through its own setter", () => {
    const { result } = renderHook(() => useBoardDialogs());
    act(() => result.current.setShowNew(true));
    expect(result.current.showNew).toBe(true);
    act(() => result.current.setShowNew(false));
    expect(result.current.showNew).toBe(false);

    act(() => result.current.setMenuOpen(true));
    expect(result.current.menuOpen).toBe(true);
    act(() => result.current.setMenuOpen(false));
    expect(result.current.menuOpen).toBe(false);

    act(() => result.current.setShowSettings(true));
    expect(result.current.showSettings).toBe(true);
    act(() => result.current.setShowSettings(false));
    expect(result.current.showSettings).toBe(false);

    act(() => result.current.setShowHelp(true));
    expect(result.current.showHelp).toBe(true);
    act(() => result.current.setShowHelp(false));
    expect(result.current.showHelp).toBe(false);

    act(() => result.current.setShowPalette(true));
    expect(result.current.showPalette).toBe(true);
    act(() => result.current.setShowPalette(false));
    expect(result.current.showPalette).toBe(false);
  });

  it("keeps the palette query and the sharing sheet as their own state", () => {
    const { result } = renderHook(() => useBoardDialogs());
    act(() => result.current.setPaletteQuery("weft:done"));
    expect(result.current.paletteQuery).toBe("weft:done");
    expect(result.current.showPalette).toBe(false);

    act(() => result.current.setSharingBoard(true));
    expect(result.current.sharingBoard).toBe(true);
    // The share sheet sits with the columns rather than over them.
    expect(result.current.overlay).toBe(false);
    expect(result.current.boardKeys).toBe(true);

    act(() => result.current.setSharingBoard(false));
    expect(result.current.sharingBoard).toBe(false);
  });

  it("holds and clears the sign-in view", () => {
    const { result } = renderHook(() => useBoardDialogs());
    act(() => result.current.setLogin(LOGIN));
    expect(result.current.login).toBe(LOGIN);
    expect(result.current.overlay).toBe(true);
    expect(result.current.boardKeys).toBe(false);
    act(() => result.current.setLogin(null));
    expect(result.current.login).toBeNull();
    expect(result.current.overlay).toBe(false);
    expect(result.current.boardKeys).toBe(true);
  });

  it("follows the flags: New thread is not an overlay, a menu is", () => {
    const { result } = renderHook(() => useBoardDialogs());
    act(() => result.current.setShowNew(true));
    expect(result.current.overlay).toBe(false);
    expect(result.current.boardKeys).toBe(false);

    act(() => result.current.setMenuOpen(true));
    expect(result.current.overlay).toBe(true);
    expect(result.current.boardKeys).toBe(false);

    act(() => {
      result.current.setShowNew(false);
      result.current.setMenuOpen(false);
    });
    expect(result.current.overlay).toBe(false);
    expect(result.current.boardKeys).toBe(true);
  });
});