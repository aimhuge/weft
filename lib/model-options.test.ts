import { describe, expect, it } from "vitest";
import {
  cliChoiceModel,
  filterGroups,
  gooseNamed,
  labelFor,
  modelGroups,
  optionsFor,
} from "./model-options";

describe("the model a CLI runs", () => {
  it("is the first model of the CLI's own list", () => {
    expect(cliChoiceModel("claude")).toBe("claude-fable-5-1");
    expect(cliChoiceModel("puku")).toBe("opus-4.8");
  });

  it("is nothing for a CLI whose model lives in its own config", () => {
    // Codex's model is its own config, and Goose's is the provider's: neither has a model to name.
    expect(cliChoiceModel("codex")).toBe("");
    expect(cliChoiceModel("goose")).toBe("");
  });
});

describe("the rows of a menu", () => {
  it("offers no row that lets the CLI choose", () => {
    for (const backend of ["claude", "puku", "codex", "goose"] as const) {
      const labels = optionsFor(backend).map((r) => r.label);
      expect(labels.some((l) => /let .* choose/i.test(l))).toBe(false);
    }
  });

  it("gives a CLI whose model lives in its own config one row for it", () => {
    expect(optionsFor("codex").map((r) => r.label)).toEqual(["Codex’s configured model"]);
    expect(optionsFor("goose").map((r) => r.label)).toContain("Your BYOK model");
  });

  it("puts the models the user named first, under their names", () => {
    const rows = optionsFor("goose", { named: [{ id: "puku-ai-2.8", name: "Puku AI 2.8" }] });
    // A named id that another CLI serves ("puku-ai-2.8" through a Puku key) is prefixed, so it
    // can't be mistaken for puku-cli's own row.
    expect(rows[0]).toMatchObject({ value: "goose:puku-ai-2.8", label: "Puku AI 2.8" });
  });

  it("shows no id beside a name that is already the id", () => {
    const rows = optionsFor("goose", { named: [{ id: "gpt-4.1", name: "gpt-4.1" }] });
    expect(rows[0]!.id).toBeUndefined();
  });

  it("shows a named model's id beside its name when they differ", () => {
    const rows = optionsFor("goose", { named: [{ id: "anthropic/claude-opus-4.1", name: "Big Opus" }] });
    expect(rows[0]).toMatchObject({ label: "Big Opus", id: "anthropic/claude-opus-4.1" });
  });

  it("shows a named model once, not again under its raw id", () => {
    const rows = optionsFor("goose", { named: [{ id: "puku-ai-2.8", name: "Puku AI 2.8" }] });
    expect(rows.filter((r) => r.value === "goose:puku-ai-2.8")).toHaveLength(1);
  });

  it("marks a model that has hit its limit", () => {
    const rows = optionsFor("claude", { atLimit: new Set(["claude-opus-5-5"]) });
    expect(rows.find((r) => r.value === "claude-opus-5-5")?.note).toBe("At its limit");
    expect(rows.find((r) => r.value === "claude-fable-5-1")?.note).toBeUndefined();
  });

  it("hides a model the CLI can't serve", () => {
    const rows = optionsFor("goose", { offer: (b, id) => b !== "goose" || id === "gpt-4.1" });
    expect(rows.some((r) => r.value === "openai/gpt-4.1")).toBe(false);
  });
});

describe("the Goose models a menu lists", () => {
  it("adds the model Goose is configured to run, showing it by its id", () => {
    const rows = gooseNamed([], "puku-ai-2.8");
    expect(rows).toEqual([{ id: "puku-ai-2.8", name: "puku-ai-2.8" }]);
  });

  it("keeps the name the user gave the configured model", () => {
    const rows = gooseNamed([{ id: "puku-ai-2.8", name: "My Puku" }], "puku-ai-2.8");
    expect(rows).toEqual([{ id: "puku-ai-2.8", name: "My Puku" }]);
  });

  it("adds nothing when the configured model is the provider's own pick", () => {
    // "goose-default" means "whatever the provider chooses", which the menu already has a row for.
    expect(gooseNamed([], "goose-default")).toEqual([]);
  });

  it("adds nothing when no model is configured", () => {
    expect(gooseNamed([], "")).toEqual([]);
    expect(gooseNamed([], "   ")).toEqual([]);
  });
});

describe("the menu's groups", () => {
  it("has one group per CLI, in the CLIs' order", () => {
    const groups = modelGroups();
    expect(groups.map((g) => g.backend)).toEqual(["claude", "puku", "codex", "goose"]);
  });

  it("heads each group with its CLI's name alone: every CLI runs behind Weft's guards (lib/guards)", () => {
    const groups = modelGroups();
    expect(groups.find((g) => g.backend === "codex")?.heading).toBe("Codex");
    expect(groups.find((g) => g.backend === "claude")?.heading).toBe("Claude Code");
  });

  it("never calls a row a default, and never offers a 'choose' row", () => {
    for (const group of modelGroups()) {
      for (const row of group.rows) {
        expect(row.label.toLowerCase()).not.toContain("default");
        expect(row.label.toLowerCase()).not.toMatch(/let .* choose/);
      }
    }
  });
});

describe("the label a picked value shows", () => {
  it("shows a named model's name", () => {
    const groups = modelGroups({ named: { goose: [{ id: "puku-ai-2.8", name: "Puku AI 2.8" }] } });
    expect(labelFor("goose:puku-ai-2.8", groups)).toBe("Puku AI 2.8");
  });

  it("shows a plain model's label", () => {
    const groups = modelGroups();
    expect(labelFor("claude-opus-5-5", groups)).toBe("Opus 5.5");
  });

  it("shows the model the CLI runs for an empty pick, never a 'let it choose' row", () => {
    const groups = modelGroups();
    expect(labelFor("", groups)).toBe("Fable 5.1");
    expect(labelFor("", groups)).not.toMatch(/choose/i);
  });
});

describe("filtering the rows", () => {
  const groups = modelGroups();

  it("keeps every row when nothing is typed", () => {
    expect(filterGroups(groups, "")).toHaveLength(groups.length);
  });

  it("finds a model by its name on any CLI", () => {
    const kept = filterGroups(groups, "opus");
    const rows = kept.flatMap((g) => g.rows);
    expect(rows.some((r) => r.label === "Opus 5.5")).toBe(true);
    expect(rows.some((r) => r.label === "Opus 4.8")).toBe(true);
  });

  it("finds a model by its id", () => {
    const kept = filterGroups(groups, "opus-4.8");
    expect(kept.flatMap((g) => g.rows).some((r) => r.value === "opus-4.8")).toBe(true);
  });

  it("finds every model of one CLI by the CLI's name", () => {
    const kept = filterGroups(groups, "goose");
    expect(kept).toHaveLength(1);
    expect(kept[0]!.backend).toBe("goose");
  });

  it("drops a group with nothing left in it", () => {
    const kept = filterGroups(groups, "nothing matches this");
    expect(kept).toHaveLength(0);
  });
});
