// Composing the next harness out of the candidates and the lessons (docs/architecture/goose.md).
//
// This is the "compose" step of Harness²: the candidates that were run are compared (lib/harness-
// contrast.ts) and the best one's edits are carried over into the harness the next task starts from.
//
// Two rules hold here, and both are about trust:
//
// - The composed harness edits ONLY the allowlisted surfaces (lib/harness-policy.ts). Anything a candidate
//   tried to change outside them is dropped, not carried.
// - Every edit carries a reason, so the composed harness can be read back and audited: "the instructions
//   gained the run-the-tests step, because the winning run made 3 fewer failed tool calls".
//
// A composition that changes nothing is a real outcome, not a failure: the original harness won, so it
// stays.
//
// Pure: no fs, no env, no globals.

import type { Contrast } from "./harness-contrast";
import type { Lesson } from "./harness-lessons";
import { changedSurfaces, enforcePolicy, HARNESS_SURFACES, type Harness, type HarnessPolicy, type HarnessSurface } from "./harness-policy";

/** One edit the composition made, and why. */
export interface HarnessEdit {
  surface: HarnessSurface;
  // The value before the edit.
  from: string;
  // The value after it.
  to: string;
  // Why the edit was made, in one sentence.
  reason: string;
  // The lesson the edit came from, when it came from one.
  lesson?: string;
}

/** A composed harness and the edits that produced it. */
export interface Composition {
  harness: Harness;
  edits: HarnessEdit[];
  // The candidate the composition came from, or "" when it came from the original harness.
  from: string;
  // The lesson the composition leaned on, when it leaned on one.
  lesson?: string;
}

/** A candidate harness, with the surfaces it changed. */
export interface Candidate {
  name: string;
  harness: Harness;
  // The surfaces this candidate changed, when the caller knows them.
  changed?: HarnessSurface[];
}

/** A candidate's value on a surface, as text (the number and the list become text for the diff). */
function surfaceText(surface: HarnessSurface, harness: Harness): string {
  if (surface === "skills") return [...harness.skills].sort().join(", ");
  if (surface === "maxTurns") return String(harness.maxTurns);
  if (surface === "model") return harness.model;
  if (surface === "instructions") return harness.instructions;
  return harness.prompt;
}

/**
 * The reason a candidate's edit is kept: the measures where the winning run beat the runner-up.
 *
 * The reason names the measures, not a judgement: the winning run had fewer failed tool calls, so the
 * edit that produced that is kept.
 */
function reasonFromContrast(contrast: Contrast): string {
  const relevant = contrast.diffs.filter((diff) => diff.measure === "toolFailures" || diff.measure === "toolSuccesses" || diff.measure === "turns" || diff.measure === "completed" || diff.measure === "tokens");
  if (!relevant.length) return `The winning run scored ${contrast.margin} above the runner-up.`;
  return `The winning run scored ${contrast.margin} above the runner-up: ${relevant.map((d) => `${d.measure} ${d.left} vs ${d.right}`).join(", ")}.`;
}

/**
 * Why an edit was made: the lesson behind it when there is one, and the contrast when there isn't.
 *
 * A lesson is the stronger of the two claims, because it carries its own evidence — how many rounds it
 * held up and what it was worth. Without one, the reason is the behavioural difference the winning run
 * showed.
 */
function reasonFor(lessons: Lesson[], surface: HarnessSurface, contrast: Contrast): { reason: string; lesson?: string } {
  const relevant = lessons.filter((lesson) => lesson.surface === surface);
  const top = relevant[0];
  if (!top) return { reason: reasonFromContrast(contrast) };
  return {
    reason: `The lesson “${top.name}” held up over ${top.timesHeld} round(s) and was worth ${top.effect}.`,
    lesson: top.name,
  };
}

/**
 * The edits a winner contributes, on the allowlisted surfaces only.
 *
 * A candidate's edit on a surface outside the allowlist is never carried: the list of surfaces is the
 * whole of what may change, and anything else in the candidate is ignored. The `from` of an edit is the
 * original harness's value on that surface, so an edit reads as the change it makes.
 */
function editsFrom(original: Harness, winner: Candidate, contrast: Contrast, lessons: Lesson[]): HarnessEdit[] {
  const edits: HarnessEdit[] = [];
  for (const surface of HARNESS_SURFACES) {
    // The candidate's own record of what it changed: the surfaces outside the list are never carried.
    if (!winner.changed?.includes(surface)) continue;
    const { reason, lesson } = reasonFor(lessons, surface, contrast);
    edits.push({
      surface,
      from: surfaceText(surface, original),
      to: surfaceText(surface, winner.harness),
      reason,
      ...(lesson ? { lesson } : {}),
    });
  }
  return edits;
}

/**
 * Compose the next harness.
 *
 * The winner's edits are carried over and the lessons are folded in. What comes out is the harness the
 * candidates ASKED for, not a repaired one: the policy is applied by the caller, after it has validated
 * the proposal. When the winner is the original harness, or when it changed nothing, the composition is
 * empty and the original harness stands.
 */
export function composeHarness(
  original: Harness,
  candidates: Candidate[],
  contrast: Contrast,
  lessons: Lesson[] = [],
): Composition {
  const winner = candidates.find((candidate) => candidate.name === contrast.winner);
  if (!winner) return { harness: original, edits: [], from: "" };

  const edits = editsFrom(original, winner, contrast, lessons);
  if (!edits.length) {
    // The original harness won: nothing to change, and the recipe stands.
    return { harness: original, edits: [], from: winner.name };
  }

  let harness: Harness = { ...winner.harness };
  // The skills the lessons name are folded in. Whether the card HAS them is the policy's job, and it
  // runs after this.
  const lessonSkills = lessons.flatMap((lesson) => (lesson.surface === "skills" ? [lesson.name] : []));
  if (lessonSkills.length) harness = { ...harness, skills: [...new Set([...harness.skills, ...lessonSkills])] };

  return { harness, edits, from: winner.name };
}

/**
 * A composition with the policy applied: the harness the runner will use, and the edits that really
 * reach it.
 *
 * An edit the policy overrode is not the edit that reaches the runner: it is dropped, and the surviving
 * edits carry the values the enforced harness actually has. So the audit trail lists only the changes
 * that are really made.
 */
export function applyPolicy(composition: Composition, original: Harness, policy: HarnessPolicy): Composition {
  const enforced = enforcePolicy(composition.harness, policy, original);
  const survived = new Set(changedSurfaces(original, enforced));
  return {
    ...composition,
    harness: enforced,
    edits: composition.edits
      .filter((edit) => survived.has(edit.surface))
      .map((edit) => ({ ...edit, to: surfaceText(edit.surface, enforced) })),
  };
}

/**
 * The composition as a note someone can read: the edits and their reasons, one per line.
 */
export function describeComposition(composition: Composition): string {
  if (!composition.edits.length) return "No edit: the original harness won.";
  return composition.edits.map((edit) => `${edit.surface}: ${edit.reason}`).join("\n");
}

/** The surfaces a composition touched, against the harness it started from. */
export function composedSurfaces(original: Harness, composition: Composition): HarnessSurface[] {
  return changedSurfaces(original, composition.harness);
}
