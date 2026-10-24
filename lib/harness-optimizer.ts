// The harness optimizer: the sidecar that improves a Goose thread's harness
// (docs/architecture/goose.md).
//
// Harness²'s loop, with Weft's safety boundary:
//
//   propose  → the agent suggests edits to its own harness (the prompt, the instructions, the model, the
//              max_turns, the skills it is told about)
//   probe    → a few candidate harnesses are run on the same task
//   contrast → the runs are compared on how they behaved (lib/harness-contrast.ts), never against an answer
//   compose  → the winner's edits are carried over (lib/harness-compose.ts)
//   validate → the composed harness is checked against the policy (lib/harness-policy.ts)
//   adopt    → only then is the new recipe used
//
// The last step is the important one. The previous recipe is kept until a composed one validates, so a
// round that goes wrong costs a run and nothing else. And the policy lives OUTSIDE the editable recipe:
// the optimizer may change the harness, never the tools, the provider, the key or the folder.
//
// `planRound` is pure: it decides what to run, given the harness, the lessons and the budget. The rest
// is the orchestration, and it takes the probe as an argument, so the loop can be driven by a real Goose
// run or by a stub in a test.
//
// This module has no fs: the recipes and lessons are passed in and handed back.

import { contrast, type Trajectory } from "./harness-contrast";
import { applyPolicy, composeHarness, type Composition } from "./harness-compose";
import { lessonsForSurface, type Lesson } from "./harness-lessons";
import { checkPolicy, changedSurfaces, type Harness, type HarnessPolicy, type HarnessSurface } from "./harness-policy";
import { parseRecipe, recipeYaml, type ParsedRecipe } from "./harness-recipe";
import type { GooseTurnPlan } from "./goose-recipe";

/** How many candidates a round runs. */
export const DEFAULT_CANDIDATES = 3;

/** What a round is given to work with. */
export interface RoundInput {
  // The harness the card runs under now.
  harness: Harness;
  // The lessons the card starts from.
  lessons: Lesson[];
  // The policy the card's harness is held to.
  policy: HarnessPolicy;
  // The plan the turn runs under.
  plan: GooseTurnPlan;
  // The prompt the task starts with.
  prompt: string;
  // How many candidates to run.
  candidates?: number;
}

/** One candidate a round will run. */
export interface PlannedCandidate {
  name: string;
  harness: Harness;
  // The surfaces this candidate changes.
  changed: HarnessSurface[];
  // The recipe the candidate runs as.
  recipe: string;
  // Why the candidate was proposed, in one sentence.
  reason: string;
}

/** What a round will do, before anything is run. */
export interface RoundPlan {
  round: number;
  candidates: PlannedCandidate[];
  // The recipe the card runs on if the round produces nothing usable.
  fallback: string;
}

/**
 * The candidates a round proposes.
 *
 * Each candidate changes one surface, on the strength of a lesson where there is one and on a simple
 * rotation where there isn't. One surface per candidate keeps the contrast readable: when two runs differ
 * by exactly one edit, the difference in behaviour is that edit's doing.
 */
export function planRound(input: RoundInput, round = 1): RoundPlan {
  const count = Math.max(1, input.candidates ?? DEFAULT_CANDIDATES);
  const surfaces = editableSurfaces(input.policy);
  const candidates: PlannedCandidate[] = [];

  for (let i = 0; i < count; i++) {
    const surface = surfaces[i % surfaces.length] as HarnessSurface;
    const lesson = lessonsForSurface(input.lessons, surface)[0];
    const harness = applySurface(input.harness, surface, input, lesson);
    const changed = changedSurfaces(input.harness, harness);
    // A candidate that changes nothing is no candidate at all: it would run the original harness and
    // tell the contrast nothing. So the next surface is tried instead.
    if (!changed.length) continue;
    candidates.push({
      name: `candidate-${i + 1}`,
      harness,
      changed,
      recipe: recipeYaml(harness, input.plan, `Round ${round} candidate ${i + 1}`),
      reason: lesson
        ? `A lesson about the ${surface} held up before, so this candidate tries it again.`
        : `This candidate tries a different ${surface}, to see whether the run behaves differently.`,
    });
  }

  return { round, candidates, fallback: recipeYaml(input.harness, input.plan, "Weft thread") };
}

/** The surfaces a round may propose an edit on. */
function editableSurfaces(policy: HarnessPolicy): HarnessSurface[] {
  const surfaces: HarnessSurface[] = ["instructions", "prompt"];
  if (policy.allowedModels.length) surfaces.push("model");
  if (policy.allowedSkills.length) surfaces.push("skills");
  return surfaces;
}

/**
 * What a candidate does to the surface it tries.
 *
 * The change is deliberately small and reversible: a lesson's name is added to the instructions, a skill
 * is named, a model is picked from the card's own list, and the prompt gains a line about what to do
 * first. Nothing here can change the tools, the provider or the folder.
 */
function applySurface(harness: Harness, surface: HarnessSurface, input: RoundInput, lesson?: Lesson): Harness {
  if (surface === "instructions") {
    const note = lesson
      ? `\n\n# What held up before\n${lesson.claim}`
      : "\n\n# How to work\nRead the folder before changing anything, and say what you are about to change.";
    return { ...harness, instructions: `${harness.instructions}${note}` };
  }
  if (surface === "prompt") {
    const note = lesson ? `\n\n${lesson.claim}` : "\n\nStart by reading the folder and listing what you will change.";
    return { ...harness, prompt: `${harness.prompt}${note}` };
  }
  if (surface === "model") {
    // A model the card may run that ISN'T the one it runs on now: a candidate that picked the current
    // model would change nothing and tell the contrast nothing.
    const model = input.policy.allowedModels.find((m) => m !== harness.model) ?? harness.model;
    return { ...harness, model };
  }
  // skills: a skill the card may run that it doesn't name yet. When it already names them all there is
  // nothing to add, and the candidate is dropped by the caller for changing nothing.
  const skill = input.policy.allowedSkills.find((s) => !harness.skills.includes(s));
  if (!skill) return harness;
  return { ...harness, skills: [...new Set([...harness.skills, skill])] };
}

/** What a round produced. */
export interface RoundOutcome {
  round: number;
  // The candidates that were run.
  candidates: PlannedCandidate[];
  // The contrast between the runs.
  contrast: ReturnType<typeof contrast>;
  // The composition the contrast led to.
  composition: Composition;
  // The recipe that was adopted, or the fallback when nothing validated.
  recipe: string;
  // Whether the new recipe was adopted.
  adopted: boolean;
  // Why it wasn't, when it wasn't.
  reason?: string;
  // The lesson the round taught, when it taught one.
  lesson?: Lesson;
}

/** The result of probing a candidate: the run's trajectory. */
export type Probe = (candidate: PlannedCandidate) => Promise<Trajectory>;

/**
 * Run a round: propose, probe, contrast, compose, validate.
 *
 * The recipe that comes back is the new one when it validates, and the previous one when it doesn't. The
 * previous recipe is never thrown away before the new one has passed.
 */
export async function runRound(input: RoundInput, probe: Probe, round = 1): Promise<RoundOutcome> {
  const plan = planRound(input, round);
  const trajectories: Trajectory[] = [];
  for (const candidate of plan.candidates) {
    const trajectory = await probe(candidate);
    trajectories.push({ ...trajectory, changed: candidate.changed });
  }
  const result = contrast(trajectories);
  // The proposal is what the candidates asked for, and it is what is validated: a proposal that breaks
  // the policy is refused outright, and the previous recipe stands.
  const proposal = composeHarness(input.harness, plan.candidates, result, input.lessons);
  const check = checkPolicy(proposal.harness, input.policy);
  if (!check.ok) {
    return {
      round,
      candidates: plan.candidates,
      contrast: result,
      composition: proposal,
      recipe: plan.fallback,
      adopted: false,
      reason: check.violations.map((violation) => violation.reason).join(" "),
    };
  }
  // It holds to the policy, so the repair changes nothing the policy would have stopped; it is applied
  // anyway, so the harness that is adopted is the one the runner gets.
  const composition = applyPolicy(proposal, input.harness, input.policy);
  const recipe = recipeYaml(composition.harness, input.plan, `Round ${round}`);
  return { round, candidates: plan.candidates, contrast: result, composition, recipe, adopted: true };
}

/**
 * Adopt a recipe: the one step that changes what the card runs under.
 *
 * It refuses a recipe that doesn't validate, and it refuses a recipe whose enforced fields don't survive
 * a round trip through the recipe format — because a recipe that can't be read back can't be re-run by
 * hand, and a recipe whose model or max_turns don't survive isn't the recipe that was validated.
 */
export function adopt(
  recipe: string,
  policy: HarnessPolicy,
  plan: GooseTurnPlan,
  previous: string,
): { recipe: string; adopted: boolean; reason?: string } {
  const parsed = parseRecipe(recipe);
  if (!parsed) return { recipe: previous, adopted: false, reason: "The composed recipe is not a recipe Weft wrote." };
  const harness: Harness = {
    prompt: parsed.prompt,
    instructions: parsed.instructions,
    model: parsed.model,
    maxTurns: parsed.maxTurns,
    skills: [],
  };
  const check = checkPolicy(harness, policy);
  if (!check.ok) return { recipe: previous, adopted: false, reason: check.violations.map((v) => v.reason).join(" ") };
  if (parsed.provider !== (plan.provider ?? "").trim()) {
    return { recipe: previous, adopted: false, reason: "The composed recipe names a different provider." };
  }
  // The round trip: what is read back must be what was validated, and the recipe must be the one Weft
  // writes. A hand-written recipe that happens to parse is not a recipe the runner can be trusted with.
  if (!survivesRoundTrip(recipe, parsed, plan)) {
    return { recipe: previous, adopted: false, reason: "The composed recipe does not survive a round trip." };
  }
  return { recipe, adopted: true };
}

/**
 * Whether a recipe survives being written out and read back.
 *
 * This is the belt to the validate braces: a recipe that can't be read back can't be re-run by hand,
 * and a recipe whose model, max_turns or prompt don't survive isn't the recipe that was validated.
 *
 * The round trip is compared as TEXT, not field by field: the recipe Weft writes is the canonical
 * rendering of its own harness, so anything that differs from it — a different title, a reordered
 * setting, a hand-written line — is not the recipe that was validated, whatever it parses to.
 */
export function survivesRoundTrip(recipe: string, parsed: ParsedRecipe, plan: GooseTurnPlan): boolean {
  const harness: Harness = {
    prompt: parsed.prompt,
    instructions: parsed.instructions,
    model: parsed.model,
    maxTurns: parsed.maxTurns,
    skills: [],
  };
  // The recipe must BE the recipe those fields make: a hand-written one that parses to the same values
  // but reads differently is not one Weft wrote, and is not adopted.
  return recipe === recipeYaml(harness, plan, "Weft thread");
}

/** The recipe a card's harness is currently running under, read back from its recipe text. */
export function currentHarness(recipe: string): Harness | null {
  const parsed: ParsedRecipe | null = parseRecipe(recipe);
  if (!parsed) return null;
  return { prompt: parsed.prompt, instructions: parsed.instructions, model: parsed.model, maxTurns: parsed.maxTurns, skills: [] };
}
