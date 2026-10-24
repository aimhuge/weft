// The policy boundary of the harness optimizer: what a candidate harness is allowed to change, and what it
// must never change (docs/architecture/goose.md).
//
// A "harness" here is the recipe a Goose turn runs under: the prompt text, the instructions text, the model,
// the max_turns and the skills it is told about. Everything else — which extensions and tools exist, which
// provider and key it runs on, the working directory — is POLICY, and policy lives outside the editable
// recipe: Goose's own extension allowlist and `available_tools` are what enforce it, not the recipe.
//
// So this module is the second line of defence. A composed recipe is validated against the allowlist
// before it is ever used, and the previous recipe is kept when it fails. The allowlist is passed in
// explicitly (see `HarnessPolicy`), so the caller — and not this file — decides what a card's policy is.
//
// Pure: no fs, no env, no globals.

import { GOOSE_MAX_TURNS, type GooseTurnPlan } from "./goose-recipe";

/** The surfaces a candidate harness may edit. Anything not in here is off limits. */
export type HarnessSurface = "prompt" | "instructions" | "model" | "maxTurns" | "skills";

/** Every editable surface, in a fixed order, so a composed harness is comparable to another. */
export const HARNESS_SURFACES: readonly HarnessSurface[] = ["prompt", "instructions", "model", "maxTurns", "skills"];

/** A harness: the editable surfaces, as values. */
export interface Harness {
  prompt: string;
  instructions: string;
  model: string;
  maxTurns: number;
  // The skills the harness mentions, by name. A skill the card doesn't have is dropped at validation.
  skills: string[];
}

/**
 * The policy a card's harness is held to. Everything here is what a composed recipe may NOT change, and
 * where the values it may not change come from.
 */
export interface HarnessPolicy {
  // The provider the card runs on. The recipe may not name a different one.
  provider: string;
  // The model the card started on. A composed recipe may only name a model the card is allowed to run.
  allowedModels: string[];
  // The skills the card has. A composed recipe may only mention these.
  allowedSkills: string[];
  // The working directory. The recipe may not name a different one, and the harness never writes outside it.
  cwd: string;
  // The ceiling on max_turns. Never raised above this.
  maxTurns: number;
  // The extensions and tools the card is allowed to reach. A recipe may not name one, and may not add one:
  // this list is here so a composed recipe that grew a tools block can be caught by name.
  allowedTools: string[];
}

/** A harness that changes nothing: the starting point of every round. */
export function baselineHarness(plan: GooseTurnPlan, prompt: string, instructions: string): Harness {
  return {
    prompt,
    instructions,
    model: plan.model ?? "",
    maxTurns: GOOSE_MAX_TURNS,
    skills: [],
  };
}

/** The surfaces on which two harnesses differ, in a fixed order. */
export function changedSurfaces(a: Harness, b: Harness): HarnessSurface[] {
  return HARNESS_SURFACES.filter((surface) => !sameValue(surface, a, b));
}

/**
 * Whether two harnesses agree on a surface.
 *
 * The skills are compared as one list whatever the order: a harness that names the same skills in a
 * different order has not changed on that surface.
 */
function sameValue(surface: HarnessSurface, a: Harness, b: Harness): boolean {
  if (surface === "skills") {
    const left = [...a.skills].sort();
    const right = [...b.skills].sort();
    return left.length === right.length && left.every((name, i) => name === right[i]);
  }
  if (surface === "model") return a.model === b.model;
  if (surface === "maxTurns") return a.maxTurns === b.maxTurns;
  if (surface === "instructions") return a.instructions === b.instructions;
  return a.prompt === b.prompt;
}

/** Why a composed recipe was refused, when it was. */
export interface PolicyViolation {
  surface: HarnessSurface | "recipe";
  reason: string;
}

/** The result of validating a composed harness against a policy. */
export interface PolicyCheck {
  ok: boolean;
  violations: PolicyViolation[];
}

/**
 * Whether a composed harness holds to the policy.
 *
 * The checks, in order: the model must be one the card may run; the max_turns must not exceed the
 * ceiling; the skills must all be the card's own; and the composed recipe's text must not smuggle in a
 * policy surface it has no business naming (a provider, a tools block, a cwd).
 */
export function checkPolicy(harness: Harness, policy: HarnessPolicy): PolicyCheck {
  const violations: PolicyViolation[] = [];

  if (harness.model && !policy.allowedModels.includes(harness.model)) {
    violations.push({ surface: "model", reason: `The model "${harness.model}" is not one this card may run.` });
  }
  if (harness.maxTurns > policy.maxTurns) {
    violations.push({ surface: "maxTurns", reason: `max_turns ${harness.maxTurns} is above the ceiling of ${policy.maxTurns}.` });
  }
  if (harness.maxTurns < 1) {
    violations.push({ surface: "maxTurns", reason: "max_turns must be at least 1." });
  }
  for (const skill of harness.skills) {
    if (!policy.allowedSkills.includes(skill)) {
      violations.push({ surface: "skills", reason: `The skill "${skill}" is not one of this card's own.` });
    }
  }
  for (const violation of checkPolicyText(harness, policy)) violations.push(violation);

  return { ok: violations.length === 0, violations };
}

/**
 * The policy surfaces a recipe's TEXT must not name. A recipe that mentions a provider, a tools block or a
 * working directory is trying to set policy from inside the editable surface, so it is refused even when the
 * value it names happens to be the right one: the editable surface has no business mentioning it.
 */
function checkPolicyText(harness: Harness, policy: HarnessPolicy): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const text = `${harness.prompt}\n${harness.instructions}`;
  for (const { pattern, reason } of POLICY_TEXT_PATTERNS) {
    if (pattern.test(text)) {
      violations.push({ surface: "recipe", reason });
    }
  }
  // A provider name in the text would let the prompt point the thread at another provider.
  if (policy.provider && new RegExp(`\\b${escapeRegExp(policy.provider)}\\b`).test(text)) {
    violations.push({ surface: "recipe", reason: "The recipe names a provider, which is policy." });
  }
  // A tool the card may reach is fine to talk about; a block that DECLARES the list is not: the recipe
  // has no business naming the tools at all.
  if (/^\s*tools\s*:/m.test(text)) {
    violations.push({ surface: "recipe", reason: "The recipe declares a tools block, which is policy." });
  }
  return violations;
}

/** The text patterns a recipe may not carry, with the reason each is refused. */
const POLICY_TEXT_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /^\s*goose_provider\s*:/m, reason: "The recipe sets goose_provider, which is policy." },
  { pattern: /^\s*goose_extension\s*:/m, reason: "The recipe sets goose_extension, which is policy." },
  { pattern: /^\s*extensions\s*:/m, reason: "The recipe declares extensions, which is policy." },
  { pattern: /^\s*available_tools\s*:/m, reason: "The recipe declares available_tools, which is policy." },
  { pattern: /^\s*cwd\s*:/m, reason: "The recipe sets a working directory, which is policy." },
];

/** A string safe to drop into a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A composed harness with its policy violations removed: a field it may not set is put back the way the
 * card had it. This is what a recipe is built from after validation, so a stray edit can't reach the
 * runner even by accident.
 *
 * The `original` is the harness the card was already running under: a candidate that tried to set a
 * field the policy forbids gets that field back the way it was, not blanked.
 */
export function enforcePolicy(harness: Harness, policy: HarnessPolicy, original?: Harness): Harness {
  const allowed = (value: string) => !value || policy.allowedModels.includes(value);
  const model = allowed(harness.model) ? harness.model : (original?.model ?? "");
  const maxTurns = Math.min(Math.max(1, harness.maxTurns), policy.maxTurns);
  const skills = harness.skills.filter((skill) => policy.allowedSkills.includes(skill));
  return { ...harness, model, maxTurns, skills };
}
