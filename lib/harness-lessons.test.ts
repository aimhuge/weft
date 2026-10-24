// lib/harness-lessons.ts: the lessons a card carries from one task to the next.
import { describe, expect, it } from "vitest";
import { contrast, type Trajectory } from "./harness-contrast";
import {
  lessonFromClaim,
  lessonFromContrast,
  lessonKey,
  lessonsFor,
  lessonsForSurface,
  mergeLesson,
  pruneLessons,
  reinforceLesson,
  type Lesson,
} from "./harness-lessons";

function run(over: Partial<Trajectory> = {}): Trajectory {
  return { candidate: "candidate-1", toolCalls: [], messages: 2, turns: 3, errors: 0, tokens: 1_000, completed: true, ...over };
}

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

describe("lessonKey", () => {
  it("is the surface and the name, in one key", () => {
    expect(lessonKey("instructions", " Tests-First ")).toBe("instructions:tests-first");
  });
});

describe("lessonFromContrast", () => {
  it("names the surfaces the winning harness changed", () => {
    const result = contrast([
      run({ candidate: "candidate-1", changed: ["instructions"] }),
      run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] }),
    ]);
    const learned = lessonFromContrast(result, 3, 500);
    expect(learned?.surface).toBe("instructions");
    expect(learned?.name).toBe("instructions");
    expect(learned?.effect).toBe(result.margin);
    expect(learned?.learnedAt).toBe(500);
  });

  it("carries the evidence it came from", () => {
    const result = contrast([
      run({ candidate: "candidate-1", changed: ["instructions"] }),
      run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] }),
    ]);
    const learned = lessonFromContrast(result, 3);
    expect(learned?.evidence.round).toBe(3);
    expect(learned?.evidence.candidates).toEqual(["candidate-1", "candidate-2"]);
    expect(learned?.evidence.diffs.length).toBeGreaterThan(0);
  });

  it("is null when the contrast was not decisive", () => {
    expect(lessonFromContrast(contrast([run()]), 1)).toBeNull();
  });

  it("is null when the winner changed nothing", () => {
    const result = contrast([run({ candidate: "candidate-1" }), run({ candidate: "candidate-2", completed: false, errors: 1 })]);
    expect(lessonFromContrast(result, 1)).toBeNull();
  });

  it("names a combined lesson when the winner changed more than one surface", () => {
    const result = contrast([
      run({ candidate: "candidate-1", changed: ["instructions", "prompt"] }),
      run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions", "prompt"] }),
    ]);
    const learned = lessonFromContrast(result, 1);
    expect(learned?.name).toBe("instructions-prompt-combined");
  });

  it("has no winner to learn from when there were no candidates", () => {
    expect(lessonFromContrast(contrast([]), 1)).toBeNull();
  });

  it("has no lesson when the contrast names a winner it has no run for", () => {
    expect(lessonFromContrast({ scored: [], winner: "candidate-1", margin: 3, diffs: [], decisive: true }, 1)).toBeNull();
  });
});

describe("lessonFromClaim", () => {
  it("is the lesson as stated, with its evidence", () => {
    const stated = lessonFromClaim("prompt", "read-first", "Read the folder first.", { round: 2, candidates: ["a"], margin: 3, diffs: [] }, 900);
    expect(stated.name).toBe("read-first");
    expect(stated.claim).toBe("Read the folder first.");
    expect(stated.effect).toBe(3);
    expect(stated.learnedAt).toBe(900);
  });
});

describe("reinforceLesson", () => {
  it("counts the round it held up in", () => {
    const held = reinforceLesson(lesson({ timesHeld: 1 }), 200);
    expect(held.timesHeld).toBe(2);
    expect(held.strength).toBe("solid");
  });

  it("stays weak while it has held only once", () => {
    expect(reinforceLesson(lesson({ timesHeld: 0 })).strength).toBe("weak");
  });

  it("keeps the lesson's own first-seen time", () => {
    expect(reinforceLesson(lesson({ learnedAt: 42 }), 999).learnedAt).toBe(42);
  });

  it("takes the round's time for a lesson that has none", () => {
    expect(reinforceLesson(lesson({ learnedAt: 0 }), 999).learnedAt).toBe(999);
  });
});

describe("pruneLessons", () => {
  it("keeps a solid lesson and a decisive weak one", () => {
    const kept = pruneLessons([
      lesson({ name: "a", strength: "solid" }),
      lesson({ name: "b", strength: "weak", evidence: { round: 1, candidates: [], margin: 2, diffs: [] } }),
    ]);
    expect(kept.map((l) => l.name)).toEqual(["a", "b"]);
  });

  it("drops a weak lesson that holds nothing up", () => {
    expect(pruneLessons([lesson({ strength: "weak", evidence: { round: 1, candidates: [], margin: 0, diffs: [] } })])).toEqual([]);
  });
});

describe("lessonsFor", () => {
  it("puts the lesson that held up most first", () => {
    const ordered = lessonsFor([lesson({ name: "a", timesHeld: 1 }), lesson({ name: "b", timesHeld: 5 })]);
    expect(ordered[0]?.name).toBe("b");
  });

  it("falls back to the effect, then to the name", () => {
    const ordered = lessonsFor([lesson({ name: "b", timesHeld: 2, effect: 1 }), lesson({ name: "a", timesHeld: 2, effect: 9 })]);
    expect(ordered[0]?.name).toBe("a");
    const tied = lessonsFor([lesson({ name: "b", timesHeld: 2, effect: 1 }), lesson({ name: "a", timesHeld: 2, effect: 1 })]);
    expect(tied[0]?.name).toBe("a");
  });
});

describe("lessonsForSurface", () => {
  it("is the lessons about one surface", () => {
    const picked = lessonsForSurface([lesson({ surface: "instructions" }), lesson({ surface: "prompt", name: "other" })], "prompt");
    expect(picked.map((l) => l.name)).toEqual(["other"]);
  });
});

describe("mergeLesson", () => {
  it("adds a lesson that isn't there yet", () => {
    const merged = mergeLesson([], lesson(), 200);
    expect(merged).toHaveLength(1);
  });

  it("reinforces a lesson with the same surface and name", () => {
    const merged = mergeLesson([lesson({ timesHeld: 1 })], lesson({ timesHeld: 1 }), 200);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.timesHeld).toBe(2);
  });

  it("leaves the other lessons alone when it reinforces one", () => {
    const merged = mergeLesson(
      [lesson({ name: "other", timesHeld: 3 }), lesson({ name: "tests-first", timesHeld: 1 })],
      lesson({ name: "tests-first", timesHeld: 1 }),
      200,
    );
    expect(merged.find((l) => l.name === "other")?.timesHeld).toBe(3);
    expect(merged.find((l) => l.name === "tests-first")?.timesHeld).toBe(2);
  });
});
