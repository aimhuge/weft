// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeIntake, intakeActions, openIntake, useIntakeActions, useOpenIntake } from "./intake-open";

// lib/intake-open.ts: the open intake screen as a store outside Board, and the board's actions its buttons call.

const RESULT = { imported: 1, importedFrom: [".env.local"], blanks: 0, hooks: 0, tracked: [] };

afterEach(() => {
  act(() => closeIntake());
  cleanup();
});

describe("useOpenIntake", () => {
  it("is null until an intake opens, then the folder and its result, then null again", () => {
    const { result } = renderHook(() => useOpenIntake());
    expect(result.current).toBeNull();
    act(() => openIntake("/r/shop", RESULT));
    expect(result.current).toEqual({ folder: "/r/shop", result: RESULT });
    act(() => closeIntake());
    expect(result.current).toBeNull();
  });
});

describe("useIntakeActions", () => {
  it("registers the board's actions while mounted and drops them on unmount", () => {
    const openDrawer = vi.fn();
    const select = vi.fn();
    const { unmount } = renderHook(() => useIntakeActions(openDrawer, select));
    intakeActions()?.openDrawer("vault");
    intakeActions()?.select("c1");
    expect(openDrawer).toHaveBeenCalledWith("vault");
    expect(select).toHaveBeenCalledWith("c1");
    unmount();
    expect(intakeActions()).toBeNull();
  });
});
