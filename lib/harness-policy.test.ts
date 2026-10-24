// lib/harness-policy.ts: the boundary between what a harness may change and what it may not.
import { describe, expect, it } from "vitest";
import {
  baselineHarness,
  changedSurfaces,
  checkPolicy,
  enforcePolicy,
  escapeRegExp,
  HARNESS_SURFACES,
  type Harness,
  type HarnessPolicy,
} from "./harness-policy";
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

describe("the editable surfaces", () => {
  it("are the five a candidate may touch, in a fixed order", () => {
    expect(HARNESS_SURFACES).toEqual(["prompt", "instructions", "model", "maxTurns", "skills"]);
  });
});

describe("baselineHarness", () => {
  it("is a harness that changes nothing", () => {
    expect(baselineHarness(plan, "Fix the bug", "You are Weft.")).toEqual({
      prompt: "Fix the bug",
      instructions: "You are Weft.",
      model: "sonnet",
      maxTurns: 40,
      skills: [],
    });
  });

  it("has no model when the plan names none", () => {
    expect(baselineHarness({ ...plan, model: undefined }, "p", "i").model).toBe("");
  });
});

describe("changedSurfaces", () => {
  it("is empty for two harnesses that agree", () => {
    expect(changedSurfaces(harness, { ...harness })).toEqual([]);
  });

  it("names the surfaces that differ", () => {
    expect(changedSurfaces(harness, { ...harness, maxTurns: 12 })).toEqual(["maxTurns"]);
    expect(changedSurfaces(harness, { ...harness, skills: ["a"] })).toEqual(["skills"]);
  });

  it("sees the skills it compares as one list, whatever the order", () => {
    expect(changedSurfaces({ ...harness, skills: ["a", "b"] }, { ...harness, skills: ["b", "a"] })).toEqual([]);
  });
});

describe("checkPolicy", () => {
  it("passes a harness that only touches the allowlisted surfaces", () => {
    expect(checkPolicy({ ...harness, instructions: "changed" }, policy).ok).toBe(true);
  });

  it("refuses a model the card may not run", () => {
    const check = checkPolicy({ ...harness, model: "gpt-9" }, policy);
    expect(check.ok).toBe(false);
    expect(check.violations[0]?.surface).toBe("model");
    expect(check.violations[0]?.reason).toContain("gpt-9");
  });

  it("refuses max_turns above the ceiling and below one", () => {
    expect(checkPolicy({ ...harness, maxTurns: 41 }, policy).ok).toBe(false);
    expect(checkPolicy({ ...harness, maxTurns: 0 }, policy).ok).toBe(false);
  });

  it("refuses a skill the card doesn't have", () => {
    const check = checkPolicy({ ...harness, skills: ["other:skill"] }, policy);
    expect(check.ok).toBe(false);
    expect(check.violations[0]?.surface).toBe("skills");
    expect(check.violations[0]?.reason).toContain("other:skill");
  });

  it("passes a skill the card has", () => {
    expect(checkPolicy({ ...harness, skills: ["weft:done"] }, policy).ok).toBe(true);
  });

  it("refuses a recipe that sets a policy field in its text", () => {
    const check = checkPolicy({ ...harness, instructions: "goose_provider: groq" }, policy);
    expect(check.ok).toBe(false);
    expect(check.violations.some((v) => v.surface === "recipe")).toBe(true);
  });

  it("refuses a recipe that declares extensions or tools", () => {
    expect(checkPolicy({ ...harness, prompt: "extensions:\n  - foo" }, policy).ok).toBe(false);
    expect(checkPolicy({ ...harness, prompt: "available_tools: [read]" }, policy).ok).toBe(false);
    expect(checkPolicy({ ...harness, prompt: "tools:\n  - read" }, policy).ok).toBe(false);
  });

  it("refuses a recipe that sets a working directory", () => {
    expect(checkPolicy({ ...harness, prompt: "cwd: /etc" }, policy).ok).toBe(false);
  });

  it("refuses a recipe that names the provider", () => {
    const check = checkPolicy({ ...harness, instructions: "Use openrouter for this." }, policy);
    expect(check.ok).toBe(false);
    expect(check.violations.some((v) => v.surface === "recipe")).toBe(true);
  });

  it("says nothing about a provider when the card has none", () => {
    expect(checkPolicy({ ...harness, instructions: "Use openrouter for this." }, { ...policy, provider: "" }).ok).toBe(true);
  });
});

describe("enforcePolicy", () => {
  it("puts the policy's own values back when it enforces it", () => {
    const enforced = enforcePolicy({ ...harness, model: "gpt-9", maxTurns: 99, skills: ["other:skill"] }, policy);
    expect(enforced.model).toBe("");
    expect(enforced.maxTurns).toBe(40);
    expect(enforced.skills).toEqual([]);
  });

  it("puts the original's own value back where the policy overrode one", () => {
    const enforced = enforcePolicy({ ...harness, model: "gpt-9" }, policy, harness);
    expect(enforced.model).toBe("sonnet");
  });

  it("keeps the values the policy allows", () => {
    const enforced = enforcePolicy({ ...harness, model: "haiku", skills: ["weft:done"] }, policy);
    expect(enforced.model).toBe("haiku");
    expect(enforced.skills).toEqual(["weft:done"]);
  });

  it("clamps max_turns to at least one", () => {
    expect(enforcePolicy({ ...harness, maxTurns: 0 }, policy).maxTurns).toBe(1);
  });
});

describe("escapeRegExp", () => {
  it("makes a string safe to drop into a RegExp", () => {
    expect(new RegExp(escapeRegExp("a.b")).test("a.b")).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
  });
});
