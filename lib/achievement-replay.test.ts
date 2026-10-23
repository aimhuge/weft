// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLastAchievement, REPLAY_ACHIEVEMENT_EVENT, replayLastAchievement, saveLastAchievement } from "./achievement-replay";
import type { Badge } from "./game-badges";

const current = { level: 24, title: "Loom", floor: 21160, next: 23000 };
const badge: Badge = { id: "ship-10", icon: "🚀", name: "Ten shipped", desc: "Ship 10 cards", group: "Milestones", unlocked: true };

describe("achievement replay", () => {
  beforeEach(() => localStorage.clear());

  it("replays a level-up to the current level before any popup has opened", () => {
    expect(readLastAchievement(current)).toEqual({ fresh: [], level: current });
  });

  it("gives back the last popup saved", () => {
    saveLastAchievement({ fresh: [badge], level: null });
    expect(readLastAchievement(current)).toEqual({ fresh: [badge], level: null });
    saveLastAchievement({ fresh: [], level: { ...current, level: 23 } });
    expect(readLastAchievement(current).level?.level).toBe(23);
  });

  it("reads a broken or empty entry as none", () => {
    localStorage.setItem("weft-game-last-achievement", "{not json");
    expect(readLastAchievement(current).level).toBe(current);
    localStorage.setItem("weft-game-last-achievement", JSON.stringify({ fresh: "x", level: { level: "9" } }));
    expect(readLastAchievement(current)).toEqual({ fresh: [], level: current });
  });

  it("survives storage that refuses writes", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => saveLastAchievement({ fresh: [], level: current })).not.toThrow();
    set.mockRestore();
  });

  it("asks for the replay with a window event", () => {
    const heard = vi.fn();
    window.addEventListener(REPLAY_ACHIEVEMENT_EVENT, heard);
    replayLastAchievement();
    expect(heard).toHaveBeenCalledOnce();
    window.removeEventListener(REPLAY_ACHIEVEMENT_EVENT, heard);
  });
});
