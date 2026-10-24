// The lessons a card's harness optimizer carries from one task to the next
// (docs/architecture/goose.md).
//
// A lesson is a small, named, evidence-backed claim about what changed a run's behaviour: "adding the
// run-the-tests step to the instructions cut the tool-failure rate on this card's tasks". It is not a
// fact about the world, it is a note about this card's own harness, and it carries the evidence that
// produced it — the candidates that were run and the behavioural diff between them — so a lesson can be
// read, checked and dropped when it stops holding.
//
// The lessons are kept per card and per project in ~/.weft, so a card's next task starts from what its
// last task learned, and a new card in the same project starts from the project's lessons.
//
// This module is the PURE half: the shape of a lesson, how one is derived from a contrast, and how a set
// of lessons is read. The fs half (the file, the atomic write) is in lib/harness-lessons-store.ts.
//
// Pure: no fs, no env, no globals.

import type { BehaviorDiff, Contrast } from "./harness-contrast";
import type { HarnessSurface } from "./harness-policy";

/** How much a lesson has been seen hold up. */
export type LessonStrength = "weak" | "solid";

/** The evidence a lesson carries: the runs it came from and the difference between them. */
export interface LessonEvidence {
  // The round the lesson came from, so a lesson can be traced back to its runs.
  round: number;
  // The candidates that were run, best first.
  candidates: string[];
  // The score gap between the winner and the runner-up.
  margin: number;
  // The measures where the winner differed from the runner-up.
  diffs: BehaviorDiff[];
}

/** A lesson: what changed, what it did, and the evidence for it. */
export interface Lesson {
  // A short, stable name for the change, e.g. "tests-before-done".
  name: string;
  // The surface the change was made on.
  surface: HarnessSurface;
  // What the change was, in one sentence.
  claim: string;
  // How much the change helped, as the score gap it produced.
  effect: number;
  // The evidence behind the claim.
  evidence: LessonEvidence;
  // How often the lesson has held up.
  strength: LessonStrength;
  // When the lesson was first learned, as a millisecond timestamp.
  learnedAt: number;
  // How many rounds have seen it hold up.
  timesHeld: number;
}

/** A lesson's name, as a key it can be looked up and counted by. */
export function lessonKey(surface: HarnessSurface, name: string): string {
  return `${surface}:${name.trim().toLowerCase()}`;
}

/**
 * The lesson a contrast teaches, or null when the contrast isn't decisive enough to teach one.
 *
 * The lesson names the surfaces the winning harness changed and claims that the change is what produced
 * the difference. That claim is the evidence-backed part: it holds because the winning run behaved
 * differently on the measures the diff names, not because anything said so.
 */
export function lessonFromContrast(contrast: Contrast, round: number, now = Date.now()): Lesson | null {
  if (!contrast.decisive || !contrast.winner) return null;
  const winner = contrast.scored[0];
  if (!winner) return null;
  const surfaces = [...new Set(winner.trajectory.changed ?? [])];
  if (!surfaces.length) return null;
  const surface = surfaces[0] as HarnessSurface;
  const name = surfaces.length > 1 ? `${surfaces.join("-")}-combined` : surface;
  return {
    name,
    surface,
    claim: `Changing the ${surfaces.join(", ")} on this card's harness produced the difference the contrast recorded.`,
    effect: contrast.margin,
    evidence: {
      round,
      candidates: contrast.scored.map((c) => c.candidate),
      margin: contrast.margin,
      diffs: contrast.diffs,
    },
    strength: "weak",
    learnedAt: now,
    timesHeld: 1,
  };
}

/** A lesson with its own name and claim, for a lesson Weft states rather than derives. */
export function lessonFromClaim(
  surface: HarnessSurface,
  name: string,
  claim: string,
  evidence: LessonEvidence,
  now = Date.now(),
): Lesson {
  return { name, surface, claim, effect: evidence.margin, evidence, strength: "weak", learnedAt: now, timesHeld: 1 };
}

/**
 * A lesson after it held up again: stronger, and it has seen more rounds.
 *
 * A lesson that has held twice is "solid"; one that has held once is "weak". A lesson that stops holding
 * is dropped by `pruneLessons` rather than kept around, because a lesson that no longer predicts the
 * behaviour is worse than no lesson at all.
 */
export function reinforceLesson(lesson: Lesson, now = Date.now()): Lesson {
  const timesHeld = lesson.timesHeld + 1;
  return { ...lesson, strength: timesHeld >= 2 ? "solid" : "weak", timesHeld, learnedAt: lesson.learnedAt || now };
}

/**
 * The lessons worth carrying on to the next task.
 *
 * A lesson is kept when it is solid, or when it is weak but the contrast that produced it was
 * decisive. Weak lessons from a decisive contrast are kept so the next round can test them again.
 */
export function pruneLessons(lessons: Lesson[]): Lesson[] {
  return lessons.filter((lesson) => lesson.strength === "solid" || lesson.evidence.margin > 0);
}

/**
 * The lessons that hold for a card, best first: the ones that held up most, then the ones that helped
 * most. A card reads its own lessons and its project's.
 */
export function lessonsFor(lessons: Lesson[]): Lesson[] {
  return [...lessons].sort(
    (a, b) => b.timesHeld - a.timesHeld || b.effect - a.effect || lessonKey(a.surface, a.name).localeCompare(lessonKey(b.surface, b.name)),
  );
}

/**
 * A new lesson joining a set: a lesson on the same surface and name is reinforced, not duplicated.
 */
export function mergeLesson(lessons: Lesson[], lesson: Lesson, now = Date.now()): Lesson[] {
  const key = lessonKey(lesson.surface, lesson.name);
  const existing = lessons.find((l) => lessonKey(l.surface, l.name) === key);
  if (!existing) return [...lessons, lesson];
  return lessons.map((l) => (lessonKey(l.surface, l.name) === key ? reinforceLesson(l, now) : l));
}

/**
 * The lessons that talk about a surface: what the next round should try on it.
 */
export function lessonsForSurface(lessons: Lesson[], surface: HarnessSurface): Lesson[] {
  return lessonsFor(lessons.filter((lesson) => lesson.surface === surface));
}
