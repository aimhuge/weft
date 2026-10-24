// lib/harness-lessons-store.ts: the lessons on disk.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "./harness-lessons";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-harness-lessons-"));

vi.mock("./store", () => ({ DATA_DIR: dir }));

const { cardLessons, lessonsForCard, projectLessons, recordLesson, saveCardLessons, saveProjectLessons } = await import("./harness-lessons-store");

function lesson(over: Partial<Lesson> = {}): Lesson {
  return {
    name: "tests-first",
    surface: "instructions",
    claim: "Reading the folder first cut the failed tool calls.",
    effect: 2,
    evidence: { round: 1, candidates: ["candidate-1"], margin: 2, diffs: [] },
    strength: "weak",
    learnedAt: 100,
    timesHeld: 1,
    ...over,
  };
}

beforeEach(() => {
  fs.rmSync(path.join(dir, "harness-lessons.json"), { force: true });
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the lessons on disk", () => {
  it("keeps a card's own lessons", () => {
    saveCardLessons("card-1", [lesson()]);
    expect(cardLessons("card-1")).toHaveLength(1);
  });

  it("keeps a project's lessons", () => {
    saveProjectLessons("/repo", [lesson()]);
    expect(projectLessons("/repo")).toHaveLength(1);
  });

  it("has no lessons for a card it hasn't seen", () => {
    expect(cardLessons("card-2")).toEqual([]);
    expect(projectLessons("/other")).toEqual([]);
  });

  it("gives a card its own lessons and its project's", () => {
    saveCardLessons("card-1", [lesson({ name: "mine" })]);
    saveProjectLessons("/repo", [lesson({ name: "theirs" })]);
    expect(lessonsForCard("card-1", "/repo").map((l) => l.name)).toEqual(["mine", "theirs"]);
  });

  it("reads a file that isn't there as no lessons", () => {
    expect(cardLessons("card-1")).toEqual([]);
  });

  it("reads a file that isn't JSON as no lessons", () => {
    fs.writeFileSync(path.join(dir, "harness-lessons.json"), "not json");
    expect(cardLessons("card-1")).toEqual([]);
  });

  it("drops a lesson that lost its fields", () => {
    fs.writeFileSync(path.join(dir, "harness-lessons.json"), JSON.stringify({ cards: { "card-1": [lesson(), { name: "broken" }] } }));
    expect(cardLessons("card-1")).toHaveLength(1);
  });

  it("drops a lesson that is not an object at all", () => {
    fs.writeFileSync(path.join(dir, "harness-lessons.json"), JSON.stringify({ cards: { "card-1": [null, "text", 7] } }));
    expect(cardLessons("card-1")).toEqual([]);
  });

  it("has no lessons when the file's list is not a list", () => {
    fs.writeFileSync(path.join(dir, "harness-lessons.json"), JSON.stringify({ cards: { "card-1": "nope" } }));
    expect(cardLessons("card-1")).toEqual([]);
  });

  it("reads a file with neither scope as both scopes empty", () => {
    fs.writeFileSync(path.join(dir, "harness-lessons.json"), JSON.stringify({}));
    expect(cardLessons("card-1")).toEqual([]);
    expect(projectLessons("/repo")).toEqual([]);
  });
});

describe("recordLesson", () => {
  it("adds the lesson to the card's and the project's sets", () => {
    recordLesson("card-1", "/repo", lesson());
    expect(cardLessons("card-1")).toHaveLength(1);
    expect(projectLessons("/repo")).toHaveLength(1);
  });

  it("reinforces a lesson that is already there instead of duplicating it", () => {
    recordLesson("card-1", "/repo", lesson());
    recordLesson("card-1", "/repo", lesson());
    const stored = cardLessons("card-1");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.timesHeld).toBe(2);
    expect(stored[0]?.strength).toBe("solid");
  });

  it("keeps a lesson weak while it has held only once", () => {
    recordLesson("card-1", "/repo", lesson());
    expect(cardLessons("card-1")[0]?.strength).toBe("weak");
  });

  it("keeps a lesson's own strength while it has not held yet", () => {
    // A lesson stored with no holds yet: one more hold is still not two, so its strength stands.
    saveCardLessons("card-1", [lesson({ timesHeld: 0 })]);
    recordLesson("card-1", "/repo", lesson());
    const stored = cardLessons("card-1");
    expect(stored[0]?.timesHeld).toBe(1);
    expect(stored[0]?.strength).toBe("weak");
  });

  it("leaves the other lessons in the scope alone", () => {
    // The scope holds the lesson being recorded AND another one: the recorded one is reinforced and
    // the other one is left exactly as it was.
    saveCardLessons("card-1", [lesson({ name: "other", timesHeld: 4 }), lesson({ name: "tests-first", timesHeld: 1 })]);
    recordLesson("card-1", "/repo", lesson({ name: "tests-first" }));
    const stored = cardLessons("card-1");
    expect(stored.find((l) => l.name === "other")?.timesHeld).toBe(4);
    expect(stored.find((l) => l.name === "tests-first")?.timesHeld).toBe(2);
  });
});
