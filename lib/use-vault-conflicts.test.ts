// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VaultBridge, VaultConflict } from "./vault-view";
import type { Editing } from "./vault-row-types";
import { conflictKey, useVaultConflicts } from "./use-vault-conflicts";

// The conflicts the drawer holds (docs/architecture/teams-vault.md, "Push on change"): a write that
// lost against a teammate's leaves a banner on that secret's row, with the two ways out. The banner
// is transient — it survives the reload the conflicted write caused, and goes away on the re-render
// after the next reload.
//
// The value the user typed never reaches the page: it waits here, so "Keep your edit" can write it
// again without the banner ever holding it.

const KEY = conflictKey("github:o/web", "API_KEY", "development");

const conflict = (over: Partial<VaultConflict> = {}): VaultConflict => ({
  name: "API_KEY",
  environment: "development",
  actor: "Sam",
  rowVersion: 4,
  blank: false,
  ...over,
});

const edit: Editing = { vault: "github:o/web", folder: "/dev/web", name: "API_KEY", environments: ["development"], value: "my-new-value", fixed: true, from: "development" };

// A bridge whose set answers what the test says.
function bridge(set: (folder: string, name: string, environment: string, value: string) => unknown) {
  return { set: vi.fn((folder: string, name: string, environment: string, value: string) => Promise.resolve(set(folder, name, environment, value))) } as unknown as VaultBridge;
}

describe("useVaultConflicts", () => {
  it("holds a conflict by secret, with the edit behind it", () => {
    const { result } = renderHook(() => useVaultConflicts(null, null));
    act(() => result.current.record("github:o/web", "API_KEY", "development", conflict(), edit));
    expect(result.current.conflicts.get(KEY)).toMatchObject({ actor: "Sam", name: "API_KEY", environment: "development", rowVersion: 4 });
  });

  it("keeps the value out of the page: the conflict is metadata only", () => {
    const { result } = renderHook(() => useVaultConflicts(null, null));
    act(() => result.current.record("github:o/web", "API_KEY", "development", conflict(), edit));
    expect(JSON.stringify(Array.from(result.current.conflicts.values()))).not.toContain("my-new-value");
  });

  it("keeps your edit: writes the same value again, against the row's current version", async () => {
    const set = vi.fn(() => ({ saved: true as const }));
    const b = bridge(set);
    const { result } = renderHook(() => useVaultConflicts(b, null));
    act(() => result.current.record("github:o/web", "API_KEY", "development", conflict(), edit));

    await act(async () => {
      await result.current.keepMine(KEY);
    });

    expect(set).toHaveBeenCalledWith("/dev/web", "API_KEY", "development", "my-new-value");
    // It went through: the banner goes away.
    expect(result.current.conflicts.has(KEY)).toBe(false);
  });

  it("keeps the banner when the write loses again, with the newer row", async () => {
    const set = vi.fn(() => ({ saved: false as const, conflict: conflict({ rowVersion: 5 }) }));
    const b = bridge(set);
    const { result } = renderHook(() => useVaultConflicts(b, null));
    act(() => result.current.record("github:o/web", "API_KEY", "development", conflict(), edit));

    await act(async () => {
      await result.current.keepMine(KEY);
    });

    expect(result.current.conflicts.get(KEY)).toMatchObject({ rowVersion: 5 });
  });

  it("keeps theirs: writes nothing, because the server's row is already in the shadow", () => {
    const set = vi.fn(() => ({ saved: true as const }));
    const b = bridge(set);
    const { result } = renderHook(() => useVaultConflicts(b, null));
    act(() => result.current.record("github:o/web", "API_KEY", "development", conflict(), edit));

    act(() => result.current.keepTheirs(KEY));

    expect(set).not.toHaveBeenCalled();
    expect(result.current.conflicts.has(KEY)).toBe(false);
  });

  it("answers nothing for a secret it doesn't know", async () => {
    const { result } = renderHook(() => useVaultConflicts(bridge(() => ({ saved: true as const })), null));
    await expect(result.current.keepMine("nope")).resolves.toBe("none");
  });

  it("survives the reload the conflicted write caused, and goes away on the next one", () => {
    const { result, rerender } = renderHook(({ overview }) => useVaultConflicts(null, overview), { initialProps: { overview: { vaults: [] } } });
    act(() => result.current.record("github:o/web", "API_KEY", "development", conflict(), edit));

    // The write's own reload: a new overview, and the banner is still there.
    rerender({ overview: { vaults: [] } });
    expect(result.current.conflicts.has(KEY)).toBe(true);

    // The next reload: the banner goes away.
    rerender({ overview: { vaults: [] } });
    expect(result.current.conflicts.has(KEY)).toBe(false);
  });

  it("ignores a re-render with the same overview", () => {
    const overview = { vaults: [] };
    const { result, rerender } = renderHook(({ ov }) => useVaultConflicts(null, ov), { initialProps: { ov: overview } });
    act(() => result.current.record("github:o/web", "API_KEY", "development", conflict(), edit));

    rerender({ ov: overview });
    expect(result.current.conflicts.has(KEY)).toBe(true);
  });
});
