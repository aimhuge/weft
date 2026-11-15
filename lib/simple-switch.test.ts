// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardMode, setBoardMode } from "./board-prefs";
import { SIMPLE_SWITCH_TOAST, switchToSimpleOnce, useSimpleSwitch } from "./simple-switch";

afterEach(() => {
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
});

describe("the one-time switch to simple mode", () => {
  it("moves an advanced board to simple once, and never again after you switch back", () => {
    expect(boardMode()).toBe("advanced");
    expect(switchToSimpleOnce()).toBe(true);
    expect(boardMode()).toBe("regular");
    setBoardMode("advanced");
    expect(switchToSimpleOnce()).toBe(false);
    expect(boardMode()).toBe("advanced");
  });

  it("leaves a board that's already simple alone, with nothing to say", () => {
    setBoardMode("regular");
    expect(switchToSimpleOnce()).toBe(false);
    expect(boardMode()).toBe("regular");
  });

  it("toasts once the board has loaded, with a button that puts advanced back", () => {
    const toast = vi.fn();
    const { rerender } = renderHook(({ loaded }) => useSimpleSwitch(loaded, toast), { initialProps: { loaded: false } });
    expect(toast).not.toHaveBeenCalled();
    rerender({ loaded: true });
    expect(toast).toHaveBeenCalledWith(SIMPLE_SWITCH_TOAST, expect.objectContaining({ label: "Switch back" }));
    (toast.mock.calls[0]?.[1] as { run: () => void }).run();
    expect(boardMode()).toBe("advanced");
  });
});
