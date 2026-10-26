import { describe, expect, it } from "vitest";
import {
  CLI_CHOICE,
  cliChoiceBackend,
  cliChoiceLabel,
  cliChoiceNote,
  filterGroups,
  isCliChoice,
  labelFor,
  modelGroups,
  optionsFor,
} from "./model-options";

describe("the CLI's own choice", () => {
  it("is named for what it does, not for being a default", () => {
    expect(cliChoiceLabel("claude")).toBe("Let Claude Code choose");
    expect(cliChoiceLabel("puku")).toBe("Let puku-cli choose");
    expect(cliChoiceLabel("codex")).toBe("Let Codex choose");
    expect(cliChoiceLabel("goose")).toBe("Let Goose choose");
  });

  it("says nothing about a default anywhere in its label", () => {
    for (const label of (["claude", "puku", "codex", "goose"] as const).map((b) => cliChoiceLabel(b))) {
      expect(label.toLowerCase()).not.toContain("default");
    }
  });

  it("round-trips through its value", () => {
    expect(isCliChoice(CLI_CHOICE + "goose")).toBe(true);
    expect(isCliChoice("puku-ai-2.8")).toBe(false);
    expect(cliChoiceBackend(CLI_CHOICE + "goose")).toBe("goose");
    expect(cliChoiceBackend("cli:nope")).toBeUndefined();
    expect(cliChoiceBackend("puku-ai-2.8")).toBeUndefined();
  });

  it("names the model it runs when we know it", () => {
    expect(cliChoiceNote("claude")).toBe("Runs Fable 5.1");
    // Goose's choice is whatever the configured provider picks, so there is no model to name.
    expect(cliChoiceNote("goose")).toBeUndefined();
    // Codex's only entry is its own "you choose" id, which is no model to name.
    expect(cliChoiceNote("codex")).toBeUndefined();
  });
});

describe("the rows of a menu", () => {
  it("offers the CLI's own choice first, when the menu picks the CLI too", () => {
    const rows = optionsFor("claude", { withCliChoice: true });
    expect(rows[0]!.value).toBe(CLI_CHOICE + "claude");
    expect(rows[0]!.label).toBe("Let Claude Code choose");
  });

  it("shows a CLI's choice once: its own sentinel row gives way to the CLI-choice row", () => {
    for (const backend of ["codex", "goose"] as const) {
      const labels = optionsFor(backend, { withCliChoice: true }).map((r) => r.label);
      expect(labels.filter((l) => l === cliChoiceLabel(backend))).toHaveLength(1);
    }
    expect(optionsFor("codex", { withCliChoice: true }).map((r) => r.value)).toEqual([CLI_CHOICE + "codex"]);
  });

  it("leaves the CLI's own choice out when the menu doesn't pick the CLI", () => {
    const rows = optionsFor("claude");
    expect(rows.some((r) => isCliChoice(r.value))).toBe(false);
  });

  it("puts the models the user named first, under their names", () => {
    const rows = optionsFor("goose", { named: [{ id: "puku-ai-2.8", name: "Puku AI 2.8" }] });
    expect(rows[0]).toMatchObject({ value: "puku-ai-2.8", label: "Puku AI 2.8" });
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
    expect(rows.filter((r) => r.value === "puku-ai-2.8")).toHaveLength(1);
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

  it("never calls a row a default", () => {
    const groups = modelGroups({ withCliChoice: true });
    for (const group of groups) {
      for (const row of group.rows) {
        expect(row.label.toLowerCase()).not.toContain("default");
      }
    }
  });
});

describe("the label a picked value shows", () => {
  it("shows a named model's name", () => {
    const groups = modelGroups({ named: { goose: [{ id: "puku-ai-2.8", name: "Puku AI 2.8" }] } });
    expect(labelFor("puku-ai-2.8", groups)).toBe("Puku AI 2.8");
  });

  it("shows a plain model's label", () => {
    const groups = modelGroups();
    expect(labelFor("claude-opus-5-5", groups)).toBe("Opus 5.5");
  });
});

describe("filtering the rows", () => {
  const groups = modelGroups({ withCliChoice: true });

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
    const kept = filterGroups(groups, "gpt-4.1");
    expect(kept.flatMap((g) => g.rows).some((r) => r.value === "openai/gpt-4.1")).toBe(true);
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
