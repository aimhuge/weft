// lib/harness-compose.ts: composing the next harness from the candidates and the lessons.
import { describe, expect, it } from "vitest";
import { applyPolicy, composeHarness, composedSurfaces, describeComposition, type Candidate } from "./harness-compose";
import { contrast, type Trajectory } from "./harness-contrast";
import type { Lesson } from "./harness-lessons";
import type { Harness, HarnessPolicy } from "./harness-policy";

const harness: Harness = { prompt: "Fix the bug", instructions: "You are Weft.", model: "sonnet", maxTurns: 40, skills: [] };

const policy: HarnessPolicy = {
  provider: "openrouter",
  allowedModels: ["sonnet", "haiku"],
  allowedSkills: ["weft:done"],
  cwd: "/repo",
  maxTurns: 40,
  allowedTools: ["read", "bash"],
};

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
    strength: "solid",
    learnedAt: 1,
    timesHeld: 2,
    ...over,
  };
}

describe("composeHarness", () => {
  it("carries the winner's edit over, with a reason", () => {
    const winner: Candidate = {
      name: "candidate-1",
      harness: { ...harness, instructions: "You are Weft.\n\nRead the folder first." },
      changed: ["instructions"],
    };
    const result = contrast([run({ candidate: "candidate-1", changed: ["instructions"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] })]);
    const composition = composeHarness(harness, [winner], result);
    expect(composition.harness.instructions).toContain("Read the folder first.");
    expect(composition.edits).toHaveLength(1);
    expect(composition.edits[0]?.surface).toBe("instructions");
    expect(composition.edits[0]?.reason).toBeTruthy();
    expect(composition.from).toBe("candidate-1");
  });

  it("makes no edit when the original harness won", () => {
    const winner: Candidate = { name: "candidate-1", harness, changed: [] };
    const result = contrast([run({ candidate: "candidate-1" }), run({ candidate: "candidate-2", completed: false, errors: 1 })]);
    const composition = composeHarness(harness, [winner], result);
    expect(composition.edits).toEqual([]);
    expect(composition.harness).toEqual(harness);
    expect(describeComposition(composition)).toMatch(/No edit/);
  });

  it("makes no edit when the winner changed nothing", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness }, changed: [] };
    const result = contrast([run({ candidate: "candidate-1" })]);
    const composition = composeHarness(harness, [winner], result);
    expect(composition.edits).toEqual([]);
  });

  it("has no winner to compose from when the contrast named none", () => {
    const composition = composeHarness(harness, [], contrast([]));
    expect(composition.harness).toEqual(harness);
    expect(composition.from).toBe("");
  });

  it("names the lesson an edit came from", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, instructions: "You are Weft.\n\nWhat held up." }, changed: ["instructions"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["instructions"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] })]);
    const composition = composeHarness(harness, [winner], result, [lesson()]);
    expect(composition.edits[0]?.lesson).toBe("tests-first");
    expect(composition.edits[0]?.reason).toContain("tests-first");
  });

  it("drops an edit the policy refuses", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, model: "gpt-9" }, changed: ["model"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["model"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["model"] })]);
    const proposal = composeHarness(harness, [winner], result);
    // The proposal is what the candidate asked for: the refused model is still in it.
    expect(proposal.harness.model).toBe("gpt-9");
    const composition = applyPolicy(proposal, harness, policy);
    // After the policy, the card's own model stands and the edit never reaches the runner.
    expect(composition.harness.model).toBe("sonnet");
    expect(composition.edits).toEqual([]);
  });

  it("folds a skills lesson in", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, skills: ["weft:done"] }, changed: ["skills"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["skills"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["skills"] })]);
    const composition = composeHarness(harness, [winner], result, [lesson({ surface: "skills", name: "weft:done" })]);
    expect(composition.harness.skills).toContain("weft:done");
  });

  it("describes the edits it made", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, instructions: "changed" }, changed: ["instructions"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["instructions"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] })]);
    const composition = composeHarness(harness, [winner], result);
    expect(describeComposition(composition)).toContain("instructions");
  });

  it("lists the surfaces a composition touched", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, instructions: "changed" }, changed: ["instructions"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["instructions"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] })]);
    const composition = composeHarness(harness, [winner], result);
    expect(composedSurfaces(harness, composition)).toEqual(["instructions"]);
  });

  it("writes the skills and the max_turns as text in the edit", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, skills: ["b", "a"], maxTurns: 12 }, changed: ["skills", "maxTurns"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["skills", "maxTurns"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["skills", "maxTurns"] })]);
    const composition = composeHarness(harness, [winner], result);
    const skills = composition.edits.find((e) => e.surface === "skills");
    const turns = composition.edits.find((e) => e.surface === "maxTurns");
    expect(skills?.to).toBe("a, b");
    expect(skills?.from).toBe("");
    expect(turns?.to).toBe("12");
    expect(turns?.from).toBe("40");
  });

  it("writes the prompt and the model as text in the edit", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, prompt: "Fix it now", model: "haiku" }, changed: ["prompt", "model"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["prompt", "model"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["prompt", "model"] })]);
    const composition = composeHarness(harness, [winner], result);
    const prompt = composition.edits.find((e) => e.surface === "prompt");
    const model = composition.edits.find((e) => e.surface === "model");
    expect(prompt?.from).toBe("Fix the bug");
    expect(prompt?.to).toBe("Fix it now");
    expect(model?.from).toBe("sonnet");
    expect(model?.to).toBe("haiku");
  });

  it("has a reason even when no lesson is behind the edit", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, instructions: "changed" }, changed: ["instructions"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["instructions"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] })]);
    const composition = composeHarness(harness, [winner], result, []);
    expect(composition.edits[0]?.reason).toBeTruthy();
    expect(composition.edits[0]?.lesson).toBeUndefined();
  });

  it("has a reason when a lesson is behind it but for another surface", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, instructions: "changed" }, changed: ["instructions"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["instructions"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions"] })]);
    const composition = composeHarness(harness, [winner], result, [lesson({ surface: "prompt", name: "other" })]);
    expect(composition.edits[0]?.reason).toBeTruthy();
  });

  it("keeps the edits the policy allows, with the values the runner gets", () => {
    const winner: Candidate = { name: "candidate-1", harness: { ...harness, instructions: "changed", model: "haiku" }, changed: ["instructions", "model"] };
    const result = contrast([run({ candidate: "candidate-1", changed: ["instructions", "model"] }), run({ candidate: "candidate-2", completed: false, errors: 1, changed: ["instructions", "model"] })]);
    const composition = applyPolicy(composeHarness(harness, [winner], result), harness, policy);
    expect(composition.harness.model).toBe("haiku");
    expect(composition.edits.find((e) => e.surface === "model")?.to).toBe("haiku");
    expect(composition.edits.find((e) => e.surface === "instructions")?.to).toBe("changed");
  });
});
