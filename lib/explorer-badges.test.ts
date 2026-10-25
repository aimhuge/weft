import { describe, expect, it } from "vitest";
import { EXPLORE_FEATURES, EXPLORER_DEFS } from "./explorer-badges";
import { INTROS } from "./feature-intros";
import type { ActivityEvent } from "./game";
import type { GameFacts } from "./game-badges";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const event = (at: number, feature?: string): ActivityEvent => ({
  id: `explore-${at}-${feature ?? ""}`, at, kind: "explore", ...(feature !== undefined && { feature }),
});

function facts(overrides: Partial<GameFacts> = {}): GameFacts {
  return {
    events: [], bestStreak: 0,
    records: { biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null },
    projects: [], projectCount: 0, refactors: 0, climbed: false, ...overrides,
  };
}

const test = (id: string) => EXPLORER_DEFS.find((d) => d.id === id)!.test;
const INTRO_FEATURES = INTROS.map((id) => `intro:${id}`);

describe("explorer badges", () => {
  it("has a badge for every feature Weft logs", () => {
    expect(EXPLORE_FEATURES.length).toBe(7);
    // Each feature has its own badge id, and each badge is in the explorer family.
    const ids = EXPLORER_DEFS.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([
      "keymaster", "hooked", "showrunner", "snapshot", "show-and-tell", "launch-party", "public-face", "cinephile", "explorer",
    ]));
    expect(EXPLORER_DEFS.every((d) => d.group === "Weft explorer")).toBe(true);
  });

  it("unlocks on the feature's first use, dated by it", () => {
    const f = facts({ events: [event(local(24, 9), "vault")] });
    expect(test("keymaster")(f)).toEqual({ unlocked: true, at: local(24, 9) });
  });

  it("dates a feature by its first use, not its last", () => {
    const f = facts({ events: [event(local(24, 9), "vault"), event(local(26, 9), "vault")] });
    expect(test("keymaster")(f)).toEqual({ unlocked: true, at: local(24, 9) });
  });

  it("stays locked until the feature is used", () => {
    expect(test("keymaster")(facts())).toEqual({ unlocked: false, at: undefined });
  });

  it("ignores an explore event that names no feature", () => {
    const f = facts({ events: [event(local(24, 9))] });
    expect(test("keymaster")(f)).toEqual({ unlocked: false, at: undefined });
  });

  it("ignores the events that aren't explores", () => {
    const f = facts({ events: [{ id: "turn-1", at: local(24, 9), kind: "turn" }] });
    expect(test("keymaster")(f)).toEqual({ unlocked: false, at: undefined });
  });

  it("dates each feature badge by its own first use", () => {
    const f = facts({
      events: [
        event(local(24, 9), "vault"),
        event(local(25, 10), "webhook"),
        event(local(26, 11), "devserver"),
        event(local(27, 12), "screenshot"),
        event(local(28, 13), "card-share"),
        event(local(29, 14), "app-share"),
        event(local(30, 15), "profile"),
      ],
    });
    expect(test("keymaster")(f)).toEqual({ unlocked: true, at: local(24, 9) });
    expect(test("hooked")(f)).toEqual({ unlocked: true, at: local(25, 10) });
    expect(test("showrunner")(f)).toEqual({ unlocked: true, at: local(26, 11) });
    expect(test("snapshot")(f)).toEqual({ unlocked: true, at: local(27, 12) });
    expect(test("show-and-tell")(f)).toEqual({ unlocked: true, at: local(28, 13) });
    expect(test("launch-party")(f)).toEqual({ unlocked: true, at: local(29, 14) });
    expect(test("public-face")(f)).toEqual({ unlocked: true, at: local(30, 15) });
  });

  it("counts the intros a cinephile has watched", () => {
    const f = facts({ events: [event(local(24, 9), "intro:vault"), event(local(25, 9), "intro:github")] });
    expect(test("cinephile")(f)).toMatchObject({ unlocked: false, have: 2, need: INTRO_FEATURES.length });
  });

  it("is a cinephile once every intro has been watched", () => {
    const f = facts({ events: INTRO_FEATURES.map((feature, i) => event(local(24, 9) + i, feature)) });
    expect(test("cinephile")(f)).toMatchObject({ unlocked: true, have: INTRO_FEATURES.length, need: INTRO_FEATURES.length });
  });

  it("dates a cinephile by the last intro it watched", () => {
    const events = INTRO_FEATURES.map((feature, i) => event(local(24, 9) + i, feature));
    expect(test("cinephile")(facts({ events })).at).toBe(local(24, 9) + INTRO_FEATURES.length - 1);
  });

  it("is locked as a cinephile with no intros watched", () => {
    expect(test("cinephile")(facts())).toMatchObject({ unlocked: false, have: 0, need: INTRO_FEATURES.length });
  });

  it("keeps an explorer locked until every other badge is earned", () => {
    const f = facts({ events: EXPLORE_FEATURES.map((feature, i) => event(local(24, 9) + i, feature)) });
    expect(test("explorer")(f)).toMatchObject({ unlocked: false, have: 7, need: 8 });
  });

  it("unlocks an explorer once every other badge is earned", () => {
    const events = [
      ...EXPLORE_FEATURES.map((feature, i) => event(local(24, 9) + i, feature)),
      ...INTRO_FEATURES.map((feature, i) => event(local(26, 9) + i, feature)),
    ];
    expect(test("explorer")(facts({ events }))).toMatchObject({ unlocked: true, have: 8, need: 8 });
  });

  it("dates an explorer by the latest of them all", () => {
    const events = [
      ...EXPLORE_FEATURES.map((feature, i) => event(local(24, 9) + i, feature)),
      ...INTRO_FEATURES.map((feature, i) => event(local(26, 9) + i, feature)),
    ];
    expect(test("explorer")(facts({ events })).at).toBe(local(26, 9) + INTRO_FEATURES.length - 1);
  });

  it("has no explorer with nothing used", () => {
    expect(test("explorer")(facts())).toMatchObject({ unlocked: false, have: 0, need: 8 });
  });

  it("counts one use of a feature once, however often it comes back", () => {
    const f = facts({ events: [event(local(24, 9), "vault"), event(local(24, 10), "vault")] });
    expect(test("cinephile")(f)).toMatchObject({ unlocked: false, have: 0, need: INTRO_FEATURES.length });
  });
});
