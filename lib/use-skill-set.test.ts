// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSetView } from "./types";

const api = vi.hoisted(() => ({
  skillSet: vi.fn<(...args: unknown[]) => Promise<SkillSetView>>(),
  setSkill: vi.fn<(...args: unknown[]) => Promise<SkillSetView>>(),
}));
vi.mock("./client", () => ({ api }));

import { useSkillSet } from "./use-skill-set";

const projectView: SkillSetView = { seeded: true, rows: [{ kind: "skill", name: "deck", description: "d", source: "project", inProject: true, on: true, changedHere: false }] };
const toggledView: SkillSetView = { ...projectView, rows: [{ kind: "skill", name: "deck", description: "d", source: "project", inProject: true, on: false, changedHere: false }] };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useSkillSet", () => {
  beforeEach(() => {
    api.skillSet.mockResolvedValue(projectView);
    api.setSkill.mockResolvedValue(toggledView);
  });

  it("loads the view when active, and ignores the result when inactive or where is null", async () => {
    const { result } = renderHook(() => useSkillSet({ cwd: "/proj" }, true, () => {}));
    await waitFor(() => expect(result.current.view).toEqual(projectView));
    expect(api.skillSet).toHaveBeenCalledWith({ cwd: "/proj" });

    // A card key takes the card branch.
    api.skillSet.mockClear();
    const cardHook = renderHook(() => useSkillSet({ card: "c1" }, true, () => {}));
    await waitFor(() => expect(cardHook.result.current.view).toEqual(projectView));
    expect(api.skillSet).toHaveBeenCalledWith({ card: "c1" });

    // Inactive: no fetch.
    api.skillSet.mockClear();
    const off = renderHook(() => useSkillSet({ cwd: "/proj" }, false, () => {}));
    expect(off.result.current.view).toBeNull();
    expect(api.skillSet).not.toHaveBeenCalled();

    // where=null: no fetch, view stays null.
    const none = renderHook(() => useSkillSet(null, true, () => {}));
    expect(none.result.current.view).toBeNull();
    expect(api.skillSet).not.toHaveBeenCalled();

    // where=null makes toggle a no-op (no fetch, no state change).
    act(() => none.result.current.toggle("deck", false));
    expect(api.setSkill).not.toHaveBeenCalled();
  });

  it("a toggle before the set has loaded leaves nothing to update optimistically, then takes the server's view", async () => {
    api.skillSet.mockReturnValueOnce(new Promise<SkillSetView>(() => {}));
    const { result } = renderHook(() => useSkillSet({ cwd: "/slow" }, true, () => {}));
    await act(() => {
      result.current.toggle("deck", false);
      return Promise.resolve();
    });
    expect(api.setSkill).toHaveBeenCalledWith({ cwd: "/slow" }, "deck", false);
    expect(result.current.view).toEqual(toggledView);
  });

  it("toggle updates the view optimistically, then with the server's view", async () => {
    // Slow setSkill so we can observe the optimistic state before the server's view lands.
    let resolveServer!: (v: SkillSetView) => void;
    api.setSkill.mockReturnValueOnce(new Promise<SkillSetView>((r) => { resolveServer = r; }));
    const { result } = renderHook(() => useSkillSet({ cwd: "/proj" }, true, () => {}));
    await waitFor(() => expect(result.current.view).toEqual(projectView));

    await act(() => {
      result.current.toggle("deck", false);
      return Promise.resolve();
    });
    // Optimistic for a project set: row is off, inProject mirrors on, changedHere stays false.
    expect(result.current.view?.rows[0]).toMatchObject({ name: "deck", on: false, inProject: false, changedHere: false });
    expect(api.setSkill).toHaveBeenCalledWith({ cwd: "/proj" }, "deck", false);
    // Resolve the server's view and let it replace the optimistic one.
    await act(() => {
      resolveServer(toggledView);
      return Promise.resolve();
    });
    expect(result.current.view).toEqual(toggledView);
  });

  it("sends errors from the load and the toggle to notify", async () => {
    const loadNotify = vi.fn();
    api.skillSet.mockRejectedValueOnce(new Error("load blew up"));
    renderHook(() => useSkillSet({ cwd: "/proj" }, true, loadNotify));
    await waitFor(() => expect(loadNotify).toHaveBeenCalledWith(new Error("load blew up")));

    const toggleNotify = vi.fn();
    api.skillSet.mockResolvedValueOnce(projectView);
    api.setSkill.mockRejectedValueOnce(new Error("toggle blew up"));
    const { result } = renderHook(() => useSkillSet({ cwd: "/other" }, true, toggleNotify));
    await waitFor(() => expect(result.current.view).toEqual(projectView));
    act(() => {
      result.current.toggle("deck", false);
    });
    await waitFor(() => expect(toggleNotify).toHaveBeenCalledWith(new Error("toggle blew up")));
  });

  it("ignores a stale load that comes back for an old key", async () => {
    // The first load is slow and resolves after the user has unmounted the hook.
    let resolveFirst!: (v: SkillSetView) => void;
    api.skillSet.mockImplementationOnce(() => new Promise<SkillSetView>((r) => { resolveFirst = r; }));
    const first = renderHook(() => useSkillSet({ cwd: "/old" }, true, () => {}));
    expect(first.result.current.view).toBeNull();
    // Unmounting runs the effect cleanup, which sets `live = false` on the in-flight fetch.
    first.unmount();
    await act(() => {
      resolveFirst({ seeded: true, rows: [{ kind: "skill", name: "deck", description: "d", source: "project", inProject: true, on: true, changedHere: false }] });
      return Promise.resolve();
    });
    // A new hook with the same key loads fresh.
    api.skillSet.mockResolvedValueOnce({ seeded: true, rows: [] });
    const next = renderHook(() => useSkillSet({ cwd: "/old" }, true, () => {}));
    await waitFor(() => expect(next.result.current.view).toEqual({ seeded: true, rows: [] }));
  });

  it("reload loads the set again, as after a skill was installed", async () => {
    const { result } = renderHook(() => useSkillSet({ cwd: "/proj" }, true, () => {}));
    await waitFor(() => expect(result.current.view).toEqual(projectView));
    expect(api.skillSet).toHaveBeenCalledTimes(1);
    // The server's set has grown since the first load.
    const grown: SkillSetView = { ...projectView, rows: [...projectView.rows, { kind: "skill", name: "deck2", description: "d2", source: "project", inProject: true, on: true, changedHere: false }] };
    api.skillSet.mockResolvedValueOnce(grown);
    act(() => result.current.reload());
    await waitFor(() => expect(api.skillSet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.view?.rows).toHaveLength(2));
  });

  it("reload does nothing when there is no set to load", () => {
    const { result } = renderHook(() => useSkillSet(null, true, () => {}));
    act(() => result.current.reload());
    expect(api.skillSet).not.toHaveBeenCalled();
  });
});
