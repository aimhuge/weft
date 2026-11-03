// @vitest-environment jsdom
// A card's ✦ skill set from its host: this Mac's through /api/skill-sets, a worker's from its own skills.list, with a
// switch that goes as card.update { skill } and moves at once.
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, SkillInfo } from "./types";

const local = vi.hoisted(() => ({ view: { seeded: true, rows: [] }, toggle: vi.fn(), reload: vi.fn() }));
const useSkillSet = vi.hoisted(() => vi.fn<(where: unknown, active: boolean, notify: unknown) => typeof local>(() => local));
vi.mock("./use-skill-set", () => ({ useSkillSet }));

type List = (card: string, cwd: string) => Promise<SkillInfo[]>;
const host = vi.hoisted(() => {
  const thread: { listSkills?: List } = { listSkills: vi.fn<List>(() => Promise.resolve([{ name: "ship", description: "", source: "weft" }])) };
  return { kind: "cloud", act: vi.fn<(verb: string, args: unknown) => Promise<undefined>>(() => Promise.resolve(undefined)), thread };
});
vi.mock("./project-host", () => ({ hostOf: () => host }));

const { useCardSkillSet } = await import("./use-card-skill-set");
const card = { id: "w-card", cwd: "worker://w1/app", skillsOff: [] } as unknown as Card;

const listed = host.thread.listSkills;
beforeEach(() => {
  vi.clearAllMocks();
  host.kind = "cloud";
  host.thread.listSkills = listed;
});

describe("useCardSkillSet", () => {
  it("is this Mac's skill set for one of its cards", () => {
    host.kind = "local";
    const { result } = renderHook(() => useCardSkillSet(card, true, vi.fn()));
    expect(result.current).toBe(local);
    expect(useSkillSet).toHaveBeenCalledWith({ card: "w-card" }, true, expect.any(Function));
    expect(host.thread.listSkills).not.toHaveBeenCalled();
  });

  it("lists a worker's own skills, and sets one as card.update { skill }, the switch moving first", async () => {
    const notify = vi.fn();
    const { result } = renderHook(() => useCardSkillSet(card, true, notify));
    expect(useSkillSet).toHaveBeenCalledWith({ card: "w-card" }, false, expect.any(Function));
    await waitFor(() => expect(result.current.view?.rows.map((r) => [r.name, r.on])).toEqual([["ship", true]]));
    expect(host.thread.listSkills).toHaveBeenCalledWith("w-card", "worker://w1/app");
    act(() => result.current.toggle("ship", false));
    expect(result.current.view?.rows[0]).toMatchObject({ on: false, changedHere: true });
    expect(host.act).toHaveBeenCalledWith("card.update", { id: "w-card", body: { skill: { name: "ship", on: false } } });
    expect(notify).not.toHaveBeenCalled();
  });

  it("says why a switch was refused and lists the skills again; reload lists them again too", async () => {
    const notify = vi.fn();
    const refused = new Error("No.");
    host.act.mockRejectedValueOnce(refused);
    const { result } = renderHook(() => useCardSkillSet(card, true, notify));
    await waitFor(() => expect(result.current.view).not.toBeNull());
    act(() => result.current.toggle("ship", false));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(refused));
    await waitFor(() => expect(host.thread.listSkills).toHaveBeenCalledTimes(2));
    act(() => result.current.reload());
    await waitFor(() => expect(host.thread.listSkills).toHaveBeenCalledTimes(3));
  });

  it("leaves a list that hasn't come yet alone when a switch is flipped", () => {
    host.thread.listSkills = vi.fn(() => new Promise<SkillInfo[]>(() => {}));
    const { result } = renderHook(() => useCardSkillSet(card, true, vi.fn()));
    act(() => result.current.toggle("ship", true));
    expect(result.current.view).toBeNull();
    expect(host.act).toHaveBeenCalledWith("card.update", { id: "w-card", body: { skill: { name: "ship", on: true } } });
  });

  it("reads nothing while closed, or from a transport with no list", () => {
    renderHook(() => useCardSkillSet(card, false, vi.fn()));
    expect(host.thread.listSkills).not.toHaveBeenCalled();
    const list = host.thread.listSkills;
    host.thread.listSkills = undefined;
    const { result } = renderHook(() => useCardSkillSet(card, true, vi.fn()));
    expect(result.current.view).toBeNull();
    host.thread.listSkills = list;
  });
});
