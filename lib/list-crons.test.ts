// The ⏰ badge and the Crons band in the list view (lib/list-crons.ts).
import { describe, expect, it } from "vitest";
import { cronBadge, cronsHeldBy, cronRows } from "./list-crons";
import type { Cron } from "./cron-types";
import type { Card } from "./types";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// A cron with every field filled in, so a test only says what it means to change.
const cron = (over: Partial<Cron> = {}): Cron => ({
  id: "cron1",
  name: "Daily digest",
  prompt: "do the thing",
  expr: "0 9 * * *",
  mode: "fresh",
  cwd: "/tmp",
  backend: "claude",
  permissionMode: "default",
  enabled: true,
  by: "you",
  count: 0,
  runs: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

let seq = 0;
const card = (over: Partial<Card> = {}): Card => {
  seq += 1;
  return {
    id: `c${seq}`,
    title: "Untitled",
    prompt: "do it",
    cwd: "/dev/weft",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
};

describe("cronsHeldBy", () => {
  it("holds a fork cron by its source card", () => {
    const source = card({ id: "src" });
    const forked = cron({ id: "fork", sourceId: "src" });
    const other = cron({ id: "other", sourceId: "elsewhere" });
    expect(cronsHeldBy(source, [forked, other]).map((c) => c.id)).toEqual(["fork"]);
  });

  it("holds a fresh cron by the card that is its first run", () => {
    const first = card({ id: "run1", cronId: "fresh", cronOf: "run1" });
    const fresh = cron({ id: "fresh" });
    expect(cronsHeldBy(first, [fresh]).map((c) => c.id)).toEqual(["fresh"]);
  });

  it("doesn't hold a fresh cron by a later run, whose stack points elsewhere", () => {
    const later = card({ id: "run2", cronId: "fresh", cronOf: "run1" });
    const fresh = cron({ id: "fresh" });
    expect(cronsHeldBy(later, [fresh])).toEqual([]);
  });

  it("doesn't hold a fresh cron by a card that isn't its run", () => {
    const other = card({ id: "plain" });
    const fresh = cron({ id: "fresh" });
    expect(cronsHeldBy(other, [fresh])).toEqual([]);
  });
});

describe("cronBadge", () => {
  it("says when the held cron runs next, and lists the crons in the tip", () => {
    const source = card({ id: "src" });
    const live = cron({ id: "live", name: "Live", count: 1, nextAt: NOW + 5 * MINUTE, sourceId: "src" });
    const badge = cronBadge(source, [live], NOW);
    expect(badge?.text).toBe("next in 5m");
    expect(badge?.tip).toBe("Live: every day at 9:00, 1 run");
    expect(badge?.off).toBeUndefined();
  });

  it("says 'N runs' for more than one, and marks a disabled cron as off", () => {
    const source = card({ id: "src" });
    const live = cron({ id: "live", name: "Live", count: 3, nextAt: NOW + 5 * MINUTE, sourceId: "src" });
    const disabled = cron({ id: "off", name: "Off", count: 2, enabled: false, sourceId: "src" });
    const badge = cronBadge(source, [live, disabled], NOW);
    expect(badge?.text).toBe("next in 5m");
    expect(badge?.tip).toBe("Live: every day at 9:00, 3 runs\nOff: every day at 9:00, 2 runs (off)");
  });

  it("says off when the held crons are all disabled or finished", () => {
    const source = card({ id: "src" });
    const disabled = cron({ id: "off", name: "Off", count: 1, enabled: false, sourceId: "src" });
    const finished = cron({ id: "done", name: "Done", count: 4, nextAt: undefined, sourceId: "src" });
    const badge = cronBadge(source, [disabled, finished], NOW);
    expect(badge?.text).toBe("off");
    expect(badge?.off).toBe(true);
    expect(badge?.tip).toBe("Off: every day at 9:00, 1 run (off)\nDone: every day at 9:00, 4 runs");
  });

  it("says off when a held cron is still on but has no next run left", () => {
    const source = card({ id: "src" });
    // Enabled, but past its end: no next run to wait for.
    const ended = cron({ id: "ended", name: "Ended", count: 2, enabled: true, sourceId: "src" });
    const badge = cronBadge(source, [ended], NOW);
    expect(badge?.text).toBe("off");
    expect(badge?.off).toBe(true);
    expect(badge?.tip).toBe("Ended: every day at 9:00, 2 runs");
  });

  it("speaks for the held cron that runs soonest", () => {
    const source = card({ id: "src" });
    const later = cron({ id: "later", name: "Later", count: 1, nextAt: NOW + 3 * HOUR, sourceId: "src" });
    const sooner = cron({ id: "sooner", name: "Sooner", count: 1, nextAt: NOW + 2 * MINUTE, sourceId: "src" });
    expect(cronBadge(source, [later, sooner], NOW)?.text).toBe("next in 2m");
  });

  it("names the cron a run belongs to", () => {
    const run = card({ cronId: "cron1", cronRun: 3 });
    const badge = cronBadge(run, [cron({ id: "cron1", name: "Daily digest" })], NOW);
    expect(badge?.text).toBe("run 3");
    expect(badge?.tip).toBe("Run 3 of “Daily digest”");
  });

  it("says 'of a cron' when the cron is gone", () => {
    const run = card({ cronId: "missing", cronRun: 2 });
    const badge = cronBadge(run, [], NOW);
    expect(badge?.text).toBe("run 2");
    expect(badge?.tip).toBe("Run 2 of a cron");
  });

  it("has no badge for a plain card", () => {
    expect(cronBadge(card(), [], NOW)).toBeNull();
  });

  it("has no badge for a card with a cron but no run number", () => {
    expect(cronBadge(card({ cronId: "cron1" }), [cron()], NOW)).toBeNull();
  });
});

describe("cronRows", () => {
  it("sorts the crons the way the drawer does, soonest first", () => {
    const later = cron({ id: "later", name: "Later", nextAt: NOW + HOUR });
    const sooner = cron({ id: "sooner", name: "Sooner", nextAt: NOW + MINUTE });
    const off = cron({ id: "off", name: "Off", enabled: false });
    expect(cronRows([later, off, sooner], [], "").map((r) => r.cron.id)).toEqual(["sooner", "later", "off"]);
  });

  it("keeps every cron with an empty query", () => {
    const a = cron({ id: "a", name: "Apple" });
    const b = cron({ id: "b", name: "Banana" });
    expect(cronRows([a, b], [], "").map((r) => r.cron.id)).toEqual(["a", "b"]);
  });

  it("keeps only the crons whose name matches the query", () => {
    const a = cron({ id: "a", name: "Apple digest" });
    const b = cron({ id: "b", name: "Banana report" });
    expect(cronRows([a, b], [], "apple").map((r) => r.cron.id)).toEqual(["a"]);
    expect(cronRows([a, b], [], "nothing")).toEqual([]);
  });

  it("gathers the cards of each cron's runs, newest first", () => {
    const digest = cron({ id: "digest", name: "Digest" });
    const run1 = card({ cronId: "digest", cronRun: 1 });
    const run2 = card({ cronId: "digest", cronRun: 2 });
    const other = card({ cronId: "other", cronRun: 1 });
    const rows = cronRows([digest], [run1, other, run2], "");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runs.map((c) => c.id)).toEqual([run2.id, run1.id]);
  });

  it("puts a card with no run number first, as run zero", () => {
    const digest = cron({ id: "digest", name: "Digest" });
    const numbered = card({ cronId: "digest", cronRun: 1 });
    const unnumbered = card({ cronId: "digest" });
    // The unnumbered card is given second, so the comparison also sees it in the first slot.
    const rows = cronRows([digest], [numbered, unnumbered], "");
    expect(rows[0]?.runs.map((c) => c.id)).toEqual([numbered.id, unnumbered.id]);
    const flipped = cronRows([digest], [unnumbered, numbered], "");
    expect(flipped[0]?.runs.map((c) => c.id)).toEqual([numbered.id, unnumbered.id]);
  });
});
