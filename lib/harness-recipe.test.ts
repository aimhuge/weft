// lib/harness-recipe.ts: the Goose recipe as data — read back and written out again.
import { describe, expect, it } from "vitest";
import { harnessFromRecipe, parseRecipe, recipeYaml } from "./harness-recipe";
import type { Harness } from "./harness-policy";
import type { GooseTurnPlan } from "./goose-recipe";

const plan: GooseTurnPlan = { cwd: "/repo", backend: "goose", provider: "openrouter", model: "sonnet" };

const harness: Harness = { prompt: "Fix the bug", instructions: "You are Weft.", model: "sonnet", maxTurns: 40, skills: [] };

describe("parseRecipe", () => {
  it("parses back what recipeYaml wrote", () => {
    const recipe = recipeYaml(harness, plan);
    const parsed = parseRecipe(recipe);
    expect(parsed?.prompt).toBe("Fix the bug");
    expect(parsed?.instructions).toBe("You are Weft.");
    expect(parsed?.model).toBe("sonnet");
    expect(parsed?.maxTurns).toBe(40);
    expect(parsed?.provider).toBe("openrouter");
  });

  it("reads the title and the description too", () => {
    const parsed = parseRecipe(recipeYaml(harness, plan, "Round 3"));
    expect(parsed?.title).toBe("Round 3");
    expect(parsed?.description).toBe("A Weft thread on the board.");
  });

  it("refuses a recipe with a line that has no colon", () => {
    expect(parseRecipe('title: "x"\nnonsense\nsettings:\n  max_turns: 4\nparameters: []\n')).toBeNull();
  });

  it("refuses a recipe with an indented line outside the settings block", () => {
    expect(parseRecipe('title: "x"\n  stray: 1\nsettings:\n  max_turns: 4\nparameters: []\n')).toBeNull();
  });

  it("refuses a recipe whose settings values are not quoted", () => {
    expect(parseRecipe('title: "x"\nsettings:\n  goose_provider: groq\n  max_turns: 4\nparameters: []\n')).toBeNull();
    expect(parseRecipe('title: "x"\nsettings:\n  goose_model: sonnet\n  max_turns: 4\nparameters: []\n')).toBeNull();
  });

  it("reads a comment as nothing", () => {
    const recipe = recipeYaml(harness, plan).replace("title:", "# a comment\ntitle:");
    expect(parseRecipe(recipe)?.title).toBe("Weft thread");
  });

  it("refuses a recipe whose value is a number, not a string", () => {
    expect(parseRecipe('title: 7\nsettings:\n  max_turns: 4\nparameters: []\n')).toBeNull();
  });

  it("refuses a recipe whose value is broken", () => {
    expect(parseRecipe('title: "unclosed\nsettings:\n  max_turns: 4\nparameters: []\n')).toBeNull();
  });

  it("refuses a text that isn't a recipe", () => {
    expect(parseRecipe("hello")).toBeNull();
    expect(parseRecipe('title: "x"\nunknown: 1\nsettings:\n  max_turns: 4\nparameters: []\n')).toBeNull();
    expect(parseRecipe('title: "x"\nparameters: []\n')).toBeNull();
    expect(parseRecipe('title: "x"\nsettings:\n  max_turns: 4\n')).toBeNull();
  });

  it("refuses a recipe with an unknown setting or a bad max_turns", () => {
    expect(parseRecipe('title: "x"\nsettings:\n  other: 1\nparameters: []\n')).toBeNull();
    expect(parseRecipe('title: "x"\nsettings:\n  max_turns: zero\nparameters: []\n')).toBeNull();
    expect(parseRecipe('title: "x"\nsettings:\n  max_turns: 0\nparameters: []\n')).toBeNull();
  });

  it("refuses a recipe whose values are not quoted", () => {
    expect(parseRecipe('title: x\nsettings:\n  max_turns: 4\nparameters: []\n')).toBeNull();
  });

  it("refuses a recipe with a non-empty parameters list", () => {
    expect(parseRecipe('title: "x"\nsettings:\n  max_turns: 4\nparameters: [a]\n')).toBeNull();
  });
});

describe("recipeYaml", () => {
  it("leaves the provider and the model out when there are none", () => {
    const recipe = recipeYaml({ ...harness, model: "" }, { ...plan, provider: "" });
    expect(recipe).not.toContain("goose_provider");
    expect(recipe).not.toContain("goose_model");
    expect(parseRecipe(recipe)?.provider).toBe("");
  });

  it("leaves the provider out when the plan names none at all", () => {
    const recipe = recipeYaml({ ...harness, model: "" }, { ...plan, provider: undefined });
    expect(recipe).not.toContain("goose_provider");
    expect(parseRecipe(recipe)?.provider).toBe("");
  });

  it("reads a recipe that names a provider but no model", () => {
    const parsed = parseRecipe('title: "x"\ndescription: "d"\nprompt: "p"\nsettings:\n  goose_provider: "openrouter"\n  max_turns: 40\nparameters: []\n');
    expect(parsed?.provider).toBe("openrouter");
    expect(parsed?.model).toBe("");
  });

  it("reads a recipe that names an instruction but no prompt", () => {
    const parsed = parseRecipe('title: "x"\ndescription: "d"\ninstructions: "You are Weft."\nsettings:\n  max_turns: 40\nparameters: []\n');
    expect(parsed?.instructions).toBe("You are Weft.");
    expect(parsed?.prompt).toBe("");
  });

  it("takes the provider from the plan, never from the harness", () => {
    // The provider is policy: the plan is where it comes from, and the recipe only ever names that one.
    const recipe = recipeYaml(harness, { ...plan, provider: "groq" });
    expect(parseRecipe(recipe)?.provider).toBe("groq");
  });

  it("keeps the enforced fields through a round trip", () => {
    const recipe = recipeYaml(harness, plan);
    expect(recipeYaml({ ...harness, skills: [] }, plan)).toBe(recipe);
  });
});

describe("harnessFromRecipe", () => {
  it("reads a harness back out of a recipe", () => {
    const parsed = parseRecipe(recipeYaml(harness, plan));
    expect(parsed && harnessFromRecipe(parsed)).toEqual({ ...harness, skills: [] });
  });
});
