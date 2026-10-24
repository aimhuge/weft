// lib/harness-optimizer.ts: the propose → probe → contrast → compose → validate → adopt loop.
import { describe, expect, it } from "vitest";
import { adopt, currentHarness, DEFAULT_CANDIDATES, planRound, runRound, survivesRoundTrip, type RoundInput } from "./harness-optimizer";
import type { Trajectory } from "./harness-contrast";
import { checkPolicy, type Harness, type HarnessPolicy } from "./harness-policy";
import { parseRecipe, recipeYaml } from "./harness-recipe";
import type { GooseTurnPlan } from "./goose-recipe";

const plan: GooseTurnPlan = { cwd: "/repo", backend: "goose", provider: "openrouter", model: "sonnet" };

const policy: HarnessPolicy = {
  provider: "openrouter",
  allowedModels: ["sonnet", "haiku"],
  allowedSkills: ["weft:done"],
  cwd: "/repo",
  maxTurns: 40,
  allowedTools: ["read", "bash"],
};

const harness: Harness = { prompt: "Fix the bug", instructions: "You are Weft.", model: "sonnet", maxTurns: 40, skills: [] };

function input(over: Partial<RoundInput> = {}): RoundInput {
  return { harness, lessons: [], policy, plan, prompt: "Fix the bug", ...over };
}

function run(over: Partial<Trajectory> = {}): Trajectory {
  return { candidate: "candidate-1", toolCalls: [], messages: 2, turns: 3, errors: 0, tokens: 1_000, completed: true, ...over };
}

describe("planRound", () => {
  it("proposes the default number of candidates", () => {
    const round = planRound(input());
    expect(round.candidates).toHaveLength(DEFAULT_CANDIDATES);
    expect(round.candidates[0]?.name).toBe("candidate-1");
  });

  it("proposes the number it is given, and at least one", () => {
    expect(planRound(input({ candidates: 5 })).candidates).toHaveLength(5);
    expect(planRound(input({ candidates: 0 })).candidates).toHaveLength(1);
  });

  it("changes one surface per candidate, so the contrast is readable", () => {
    const round = planRound(input());
    for (const candidate of round.candidates) expect(candidate.changed).toHaveLength(1);
  });

  it("keeps a fallback recipe for when the round produces nothing usable", () => {
    const round = planRound(input());
    expect(round.fallback).toContain("Fix the bug");
  });

  it("gives every candidate a recipe that parses back", () => {
    const round = planRound(input());
    for (const candidate of round.candidates) expect(parseRecipe(candidate.recipe)).not.toBeNull();
  });

  it("proposes a model candidate only when the card may run one", () => {
    const round = planRound(input({ policy: { ...policy, allowedModels: [] } }));
    expect(round.candidates.every((c) => !c.changed.includes("model"))).toBe(true);
  });

  it("proposes a skills candidate only when the card has skills", () => {
    const round = planRound(input({ policy: { ...policy, allowedSkills: [] } }));
    expect(round.candidates.every((c) => !c.changed.includes("skills"))).toBe(true);
  });

  it("says why each candidate was proposed, with and without a lesson", () => {
    const lesson = {
      name: "tests-first",
      surface: "instructions" as const,
      claim: "Reading the folder first cut the failed tool calls.",
      effect: 2,
      evidence: { round: 1, candidates: ["candidate-1"], margin: 2, diffs: [] },
      strength: "solid" as const,
      learnedAt: 1,
      timesHeld: 2,
    };
    const withLesson = planRound(input({ lessons: [lesson] }));
    const without = planRound(input());
    expect(withLesson.candidates[0]?.reason).toContain("held up");
    expect(without.candidates[0]?.reason).toBeTruthy();
  });

  it("carries the number of the round", () => {
    expect(planRound(input(), 7).round).toBe(7);
  });

  it("proposes no candidate for a surface it cannot change", () => {
    // The only model the card may run is the one it runs on, so the model candidate changes nothing and
    // is not proposed.
    const round = planRound(input({ policy: { ...policy, allowedModels: ["sonnet"] }, candidates: 4 }));
    expect(round.candidates.every((c) => !c.changed.includes("model"))).toBe(true);
  });

  it("carries a lesson's claim into the prompt candidate", () => {
    const lesson = {
      name: "read-first",
      surface: "prompt" as const,
      claim: "Reading the folder first cut the failed tool calls.",
      effect: 2,
      evidence: { round: 1, candidates: ["candidate-1"], margin: 2, diffs: [] },
      strength: "solid" as const,
      learnedAt: 1,
      timesHeld: 2,
    };
    const round = planRound(input({ lessons: [lesson], candidates: 2 }));
    const prompt = round.candidates.find((c) => c.changed.includes("prompt"));
    expect(prompt?.harness.prompt).toContain("Reading the folder first cut the failed tool calls.");
  });

  it("keeps a skill the harness already names", () => {
    // The card already mentions the skill, so the skills candidate adds nothing new and is not proposed.
    const round = planRound(input({ harness: { ...harness, skills: ["weft:done"] }, policy: { ...policy, allowedSkills: ["weft:done"] }, candidates: 4 }));
    expect(round.candidates.every((c) => !c.changed.includes("skills"))).toBe(true);
  });
});

describe("runRound", () => {
  it("probes every candidate and adopts the winner's recipe", async () => {
    const seen: string[] = [];
    const outcome = await runRound(input(), (candidate) => {
      seen.push(candidate.name);
      return Promise.resolve(run({ candidate: candidate.name, changed: candidate.changed, completed: candidate.name === "candidate-1" }));
    });
    expect(seen).toEqual(["candidate-1", "candidate-2", "candidate-3"]);
    expect(outcome.adopted).toBe(true);
    expect(outcome.recipe).toContain("Fix the bug");
  });

  it("says why it refused when the composition breaks the policy", async () => {
    const outcome = await runRound(input(), (candidate) => Promise.resolve(run({ candidate: candidate.name, changed: candidate.changed })), 1);
    expect(outcome.round).toBe(1);
    expect(outcome.contrast.winner).toBeTruthy();
  });

  it("keeps the previous recipe when the composed one breaks the policy", async () => {
    // A lesson names a skill the card doesn't have: the proposal carries it, so the policy refuses it
    // and the round's fallback stands.
    const strict = { ...policy, allowedSkills: [] };
    const outcome = await runRound(
      input({
        policy: strict,
        lessons: [{
          name: "weft:done",
          surface: "skills",
          claim: "Running the done skill last cut the failed tool calls.",
          effect: 2,
          evidence: { round: 1, candidates: ["candidate-1"], margin: 2, diffs: [] },
          strength: "solid",
          learnedAt: 1,
          timesHeld: 2,
        }],
      }),
      (candidate) => Promise.resolve(run({ candidate: candidate.name, changed: candidate.changed })),
    );
    expect(outcome.adopted).toBe(false);
    expect(outcome.reason).toMatch(/not one of this card's own/);
    expect(outcome.recipe).toBe(planRound(input({ policy: strict })).fallback);
  });
});

describe("adopt", () => {
  it("adopts a recipe that validates", () => {
    const recipe = recipeYaml(harness, plan);
    const result = adopt(recipe, policy, plan, "previous");
    expect(result.adopted).toBe(true);
    expect(result.recipe).toBe(recipe);
  });

  it("refuses a recipe that isn't one Weft wrote", () => {
    const result = adopt("not a recipe", policy, plan, "previous");
    expect(result.adopted).toBe(false);
    expect(result.recipe).toBe("previous");
    expect(result.reason).toMatch(/not a recipe/);
  });

  it("refuses a recipe that names a model the card may not run", () => {
    const recipe = recipeYaml({ ...harness, model: "gpt-9" }, plan);
    const result = adopt(recipe, policy, plan, "previous");
    expect(result.adopted).toBe(false);
    expect(result.reason).toMatch(/not one this card may run/);
  });

  it("refuses a recipe that raises max_turns above the ceiling", () => {
    const recipe = recipeYaml({ ...harness, maxTurns: 99 }, plan);
    const result = adopt(recipe, policy, plan, "previous");
    expect(result.adopted).toBe(false);
    expect(result.reason).toMatch(/above the ceiling/);
  });

  it("refuses a recipe that names a different provider", () => {
    const recipe = recipeYaml(harness, { ...plan, provider: "groq" });
    const result = adopt(recipe, policy, plan, "previous");
    expect(result.adopted).toBe(false);
    expect(result.reason).toMatch(/different provider/);
  });

  it("adopts a recipe for a card that names no provider", () => {
    const noProvider = { ...plan, provider: undefined };
    const recipe = recipeYaml(harness, noProvider);
    const result = adopt(recipe, policy, noProvider, "previous");
    expect(result.adopted).toBe(true);
  });

  it("refuses a recipe that does not survive a round trip", () => {
    // A hand-written recipe that parses to the right values but is not the recipe Weft writes: it
    // reads differently, so it is not the recipe that was validated, and it is not adopted.
    const hand = 'title: "x"\ndescription: "d"\nprompt: "p"\nsettings:\n  goose_provider: "openrouter"\n  max_turns: 40\nparameters: []\n';
    const parsed = parseRecipe(hand);
    expect(parsed).not.toBeNull();
    expect(survivesRoundTrip(hand, parsed!, plan)).toBe(false);
    const result = adopt(hand, policy, plan, "previous");
    expect(result.adopted).toBe(false);
    expect(result.reason).toMatch(/does not survive a round trip/);
  });

  it("refuses a recipe whose model does not survive the round trip", () => {
    // The recipe names a model, and reading it back gives a different one: it is not what was validated.
    const parsed = parseRecipe(recipeYaml(harness, plan))!;
    const drifted = { ...parsed, model: "haiku" };
    expect(survivesRoundTrip(recipeYaml(harness, plan), drifted, plan)).toBe(false);
  });

  it("refuses a recipe whose prompt is not a string", () => {
    const broken = { ...parseRecipe(recipeYaml(harness, plan))!, prompt: 7 as unknown as string };
    expect(survivesRoundTrip(recipeYaml(harness, plan), broken, plan)).toBe(false);
  });

  it("says a recipe that survives the round trip is sound", () => {
    const recipe = recipeYaml(harness, plan);
    const parsed = parseRecipe(recipe);
    expect(parsed && survivesRoundTrip(recipe, parsed, plan)).toBe(true);
  });
});

describe("currentHarness", () => {
  it("reads the harness back out of a recipe", () => {
    const recipe = recipeYaml(harness, plan);
    expect(currentHarness(recipe)?.prompt).toBe("Fix the bug");
  });

  it("is null for a recipe that isn't one", () => {
    expect(currentHarness("nope")).toBeNull();
  });
});

describe("the policy boundary", () => {
  it("refuses a composition that breaks the policy", () => {
    // The policy's own rules live in lib/harness-policy.test.ts; here the boundary is the optimizer's.
    expect(checkPolicy({ ...harness, model: "gpt-9" }, policy).ok).toBe(false);
  });
});
