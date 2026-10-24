// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEAM_GATE_MESSAGE } from "./billing/upgrade";
import { closeUpgrade, openUpgrade, upgradeOnGate, useUpgradeReason } from "./use-upgrade";

beforeEach(() => {
  closeUpgrade();
});

afterEach(() => {
  closeUpgrade();
  cleanup();
});

describe("openUpgrade", () => {
  it("opens with the reason it's given", () => {
    const { result } = renderHook(() => useUpgradeReason());
    expect(result.current).toBeNull();
    act(() => openUpgrade("teams"));
    expect(result.current).toBe("teams");
    act(() => openUpgrade("puku-cap"));
    expect(result.current).toBe("puku-cap");
  });

  it("opens on the plan when no reason is given", () => {
    const { result } = renderHook(() => useUpgradeReason());
    act(() => openUpgrade());
    expect(result.current).toBe("plan");
  });

  it("tells every listener that it's open", () => {
    const a = renderHook(() => useUpgradeReason());
    const b = renderHook(() => useUpgradeReason());
    act(() => openUpgrade("share-room"));
    expect(a.result.current).toBe("share-room");
    expect(b.result.current).toBe("share-room");
  });
});

describe("closeUpgrade", () => {
  it("closes the dialog again", () => {
    const { result } = renderHook(() => useUpgradeReason());
    act(() => openUpgrade("teams"));
    act(() => closeUpgrade());
    expect(result.current).toBeNull();
  });

  it("is safe to close when nothing is open", () => {
    const { result } = renderHook(() => useUpgradeReason());
    act(() => closeUpgrade());
    expect(result.current).toBeNull();
  });
});

describe("upgradeOnGate", () => {
  it("opens the dialog for a refusal that names the reason", () => {
    const { result } = renderHook(() => useUpgradeReason());
    act(() => {
      upgradeOnGate({ ok: false, message: "No room.", upgrade: "share-room" });
    });
    expect(result.current).toBe("share-room");
  });

  it("knows the team gate's words from a weft.zip without the field", () => {
    const { result } = renderHook(() => useUpgradeReason());
    act(() => {
      upgradeOnGate({ ok: false, message: TEAM_GATE_MESSAGE });
    });
    expect(result.current).toBe("teams");
  });

  it("does nothing for a result that isn't a paywall", () => {
    const { result } = renderHook(() => useUpgradeReason());
    act(() => {
      upgradeOnGate({ ok: true });
      upgradeOnGate({ ok: false, message: "Not allowed." });
      upgradeOnGate({ ok: false });
    });
    expect(result.current).toBeNull();
  });

  it("hands the result back unchanged", () => {
    const done = { ok: true as const, message: "Invited." };
    expect(upgradeOnGate(done)).toBe(done);
    const refused = { ok: false as const, message: TEAM_GATE_MESSAGE, upgrade: "teams" as const };
    expect(upgradeOnGate(refused)).toBe(refused);
  });
});
