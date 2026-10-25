import { describe, expect, it } from "vitest";
import {
  atLeast, byDay, crossing, createdAt, DAY, def, first, flag, HOUR, isRefactor, liveShipped, MIN, noon, nthInADay, shipped, shown,
} from "./badge-kit";
import type { ActivityEvent } from "./game";
import type { GameFacts } from "./game-badges";

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const event = (kind: ActivityEvent["kind"], at: number, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: `${kind}-${at}-${extra.card ?? ""}`, at, kind, ...extra,
});

function facts(overrides: Partial<GameFacts> = {}): GameFacts {
  return {
    events: [], bestStreak: 0,
    records: { biggestDay: null, mostShipped: null, maxRunning: 0, fastest: null, cheapest: null },
    projects: [], projectCount: 0, refactors: 0, climbed: false, ...overrides,
  };
}

describe("badge-kit", () => {
  it("keeps its time constants", () => {
    expect(MIN).toBe(60_000);
    expect(HOUR).toBe(3_600_000);
    expect(DAY).toBe(86_400_000);
  });

  describe("def", () => {
    it("holds a badge's shape and its test", () => {
      const d = def("Milestones", "first", "🧵", "First", "Start a card", () => ({ unlocked: true }));
      expect(d).toMatchObject({ group: "Milestones", id: "first", icon: "🧵", name: "First", desc: "Start a card" });
      expect(d.test(facts())).toEqual({ unlocked: true });
    });

    it("takes extra badge fields", () => {
      const d = def("Secret", "hidden", "❓", "Hidden", "Keep building", () => ({ unlocked: false }), { secret: true });
      expect(d.secret).toBe(true);
    });
  });

  describe("flag", () => {
    it("is unlocked or not", () => {
      expect(flag(() => true)(facts())).toEqual({ unlocked: true });
      expect(flag(() => false)(facts())).toEqual({ unlocked: false });
    });
  });

  describe("atLeast", () => {
    it("unlocks once the count reaches n", () => {
      const count = (f: GameFacts) => f.events.length;
      const two = facts({ events: [event("turn", 1), event("turn", 2)] });
      const three = facts({ events: [event("turn", 1), event("turn", 2), event("turn", 3)] });
      expect(atLeast(count, 3)(two)).toEqual({ unlocked: false, have: 2, need: 3 });
      expect(atLeast(count, 3)(three)).toEqual({ unlocked: true, have: 3, need: 3 });
    });

    it("counts past the need as the need", () => {
      const two = facts({ events: [event("turn", 1), event("turn", 2)] });
      expect(atLeast((f) => f.events.length, 1)(two)).toEqual({ unlocked: true, have: 1, need: 1 });
    });

    it("counts nothing as zero", () => {
      expect(atLeast((f) => f.events.length, 2)(facts())).toEqual({ unlocked: false, have: 0, need: 2 });
    });
  });

  describe("first", () => {
    it("unlocks and is dated by what it found", () => {
      expect(first(() => 42)(facts())).toEqual({ unlocked: true, at: 42 });
    });

    it("stays locked when it found nothing", () => {
      expect(first(() => undefined)(facts())).toEqual({ unlocked: false, at: undefined });
    });
  });

  describe("crossing", () => {
    it("is dated by the item that crossed n", () => {
      const items = (f: GameFacts): [number, number][] => f.events.map((e) => [e.at, e.running ?? 0]);
      const f = facts({
        events: [
          event("turn", local(1, 9), { running: 4 }), event("turn", local(2, 9), { running: 4 }),
          event("turn", local(3, 9), { running: 4 }),
        ],
      });
      expect(crossing(items, 10)(f)).toEqual({ unlocked: true, at: local(3, 9), have: 10, need: 10 });
    });

    it("reads the items in time order, whatever order they come in", () => {
      const items = (): [number, number][] => [[30, 5], [10, 5], [20, 5]];
      expect(crossing(items, 10)(facts())).toEqual({ unlocked: true, at: 20, have: 10, need: 10 });
    });

    it("shows how far it got when it never crosses", () => {
      const items = (): [number, number][] => [[10, 4], [20, 5]];
      expect(crossing(items, 10)(facts())).toEqual({ unlocked: false, have: 9, need: 10 });
    });

    it("shows nothing gained from no items", () => {
      expect(crossing(() => [], 10)(facts())).toEqual({ unlocked: false, have: 0, need: 10 });
    });
  });

  describe("noon", () => {
    it("is noon local time on a day", () => {
      expect(noon("2026-10-24")).toBe(local(24, 12));
    });

    it("falls back to the first of January for a missing month or day", () => {
      expect(noon("2026")).toBe(new Date(2026, 0, 1, 12).getTime());
      expect(noon("2026-10")).toBe(new Date(2026, 9, 1, 12).getTime());
    });
  });

  describe("shipped", () => {
    it("keeps each card's first Done, oldest first", () => {
      const events = [
        event("done", local(3, 9), { card: "b" }),
        event("done", local(1, 9), { card: "a" }),
        event("done", local(2, 9), { card: "b" }),
      ];
      expect(shipped(facts({ events })).map((e) => [e.card, e.at])).toEqual([["a", local(1, 9)], ["b", local(2, 9)]]);
    });

    it("falls back to the event id when a Done names no card", () => {
      const events = [event("done", local(1, 9), { id: "done:x" }), event("done", local(2, 9), { id: "done:x" })];
      expect(shipped(facts({ events })).map((e) => e.at)).toEqual([local(1, 9)]);
    });

    it("leaves out the events that aren't Done", () => {
      expect(shipped(facts({ events: [event("turn", local(1, 9)), event("created", local(2, 9))] }))).toEqual([]);
    });
  });

  describe("liveShipped", () => {
    it("drops the backfilled Dones", () => {
      const events = [
        event("done", local(1, 9), { id: "done:x", card: "a" }),
        event("done", local(2, 9), { id: "live-1", card: "b" }),
      ];
      expect(liveShipped(facts({ events })).map((e) => e.card)).toEqual(["b"]);
    });
  });

  describe("createdAt", () => {
    it("holds when each card was created", () => {
      const events = [event("created", local(1, 9), { card: "a" }), event("created", local(2, 9), { card: "b" }), event("turn", local(3, 9))];
      expect(createdAt(facts({ events }))).toEqual(new Map([["a", local(1, 9)], ["b", local(2, 9)]]));
    });
  });

  describe("byDay", () => {
    it("groups events by their local day", () => {
      const events = [event("turn", local(24, 9)), event("turn", local(24, 18)), event("turn", local(25, 9))];
      const days = byDay(events);
      expect([...days.keys()]).toEqual(["2026-10-24", "2026-10-25"]);
      expect(days.get("2026-10-24")?.map((e) => e.at)).toEqual([local(24, 9), local(24, 18)]);
    });

    it("holds nothing when there are no events", () => {
      expect(byDay([]).size).toBe(0);
    });
  });

  describe("nthInADay", () => {
    it("is dated by the nth item of the first day that holds n", () => {
      const events = (f: GameFacts) => f.events;
      const f = facts({
        events: [
          event("turn", local(24, 9)), event("turn", local(24, 10)), event("turn", local(24, 11)),
          event("turn", local(25, 9)), event("turn", local(25, 10)),
        ],
      });
      expect(nthInADay(events, 2)(f)).toEqual({ unlocked: true, at: local(24, 10) });
      expect(nthInADay(events, 3)(f)).toEqual({ unlocked: true, at: local(24, 11) });
      expect(nthInADay(events, 4)(f)).toEqual({ unlocked: false, at: undefined });
    });

    it("skips the days that fall short", () => {
      const events = (f: GameFacts) => f.events;
      const f = facts({ events: [event("turn", local(24, 9)), event("turn", local(25, 9)), event("turn", local(25, 10))] });
      expect(nthInADay(events, 2)(f)).toEqual({ unlocked: true, at: local(25, 10) });
    });
  });

  describe("isRefactor", () => {
    it("names a refactor by what it says", () => {
      expect(isRefactor("Refactor the board")).toBe(true);
      expect(isRefactor("Extract a helper")).toBe(true);
      expect(isRefactor("Dedupe the cards")).toBe(true);
      expect(isRefactor("Split the file")).toBe(true);
      expect(isRefactor("Split a module")).toBe(true);
      expect(isRefactor("Split a component")).toBe(true);
      expect(isRefactor("Long Function: Board.tsx")).toBe(true);
      expect(isRefactor("Board: Board.tsx")).toBe(true);
    });

    it("leaves other titles alone", () => {
      expect(isRefactor("Fix the typo")).toBe(false);
      expect(isRefactor("")).toBe(false);
      expect(isRefactor()).toBe(false);
    });
  });

  describe("shown", () => {
    it("hides a secret badge until it's earned", () => {
      const badge = { secret: true, unlocked: false, icon: "🌟", name: "Star", desc: "Do the thing" };
      expect(shown(badge)).toEqual({ secret: true, unlocked: false, icon: "❓", name: "Secret badge", desc: "Keep building to find it" });
    });

    it("shows a secret badge once it's earned", () => {
      const badge = { secret: true, unlocked: true, icon: "🌟", name: "Star", desc: "Do the thing" };
      expect(shown(badge)).toEqual(badge);
    });

    it("leaves a plain badge alone", () => {
      const badge = { unlocked: false, icon: "🌟", name: "Star", desc: "Do the thing" };
      expect(shown(badge)).toEqual(badge);
    });
  });
});
