// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AWAY_COOKIE, awayStack, setAwayPrefs } from "./away-open";
import type { Column } from "./types";
import { useAwayOpen } from "./use-away-open";

function setup(selectedId: string | null = null, busy = false) {
  const select = vi.fn();
  const selectedRef = { current: selectedId };
  const columns = { current: new Map<string, Column>() };
  const hook = renderHook((props: { selectedId: string | null; busy: boolean }) =>
    useAwayOpen({ select, selectedId: props.selectedId, selectedRef, busy: props.busy, columns }),
  { initialProps: { selectedId, busy } });
  return { select, selectedRef, columns, hook };
}

describe("useAwayOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAwayPrefs({ on: true, minutes: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.cookie = `${AWAY_COOKIE}=; path=/; max-age=0`;
  });

  it("opens a card that needs you once the board has had no input for a while", () => {
    const { select, columns, hook } = setup();
    columns.current.set("a", "needs_you");
    hook.result.current("a", "needs_you", true);
    expect(select).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000);
    hook.result.current("a", "needs_you", true);
    expect(select).toHaveBeenCalledWith("a");
    hook.rerender({ selectedId: "a", busy: false });
    expect(awayStack()).toEqual(["a"]);
    hook.unmount();
  });

  it("any input resets the clock, and your own drags never open anything", () => {
    const { select, hook } = setup();
    vi.advanceTimersByTime(61_000);
    window.dispatchEvent(new Event("keydown"));
    hook.result.current("a", "needs_you", true);
    vi.advanceTimersByTime(61_000);
    hook.result.current("a", "needs_you", false);
    expect(select).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("stacks behind the open card and moves on when it's answered", () => {
    const { select, selectedRef, columns, hook } = setup();
    vi.advanceTimersByTime(61_000);
    columns.current.set("a", "needs_you").set("b", "needs_you");
    hook.result.current("a", "needs_you", true);
    selectedRef.current = "a";
    hook.result.current("b", "needs_you", true);
    hook.rerender({ selectedId: "a", busy: false });
    expect(awayStack()).toEqual(["a", "b"]);
    columns.current.set("a", "running");
    hook.result.current("a", "running", false);
    expect(select).toHaveBeenLastCalledWith("b");
    hook.rerender({ selectedId: null, busy: false });
    expect(awayStack()).toEqual([]);
    hook.unmount();
  });

  it("waits while the New thread form is open", () => {
    const { select, hook } = setup(null, true);
    vi.advanceTimersByTime(61_000);
    hook.result.current("a", "needs_you", true);
    expect(select).not.toHaveBeenCalled();
    hook.unmount();
  });
});
