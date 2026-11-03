import { describe, expect, it } from "vitest";
import { groupRows, hostSkillView, skillsOffCount, skillsOnCount, withToggled } from "./skill-set-view";
import type { SkillSetRow } from "./types";

// Build a row. Default fills are skipped for small spots.
function skill(name: string, source: SkillSetRow["source"], description = "", over: Partial<SkillSetRow> = {}): SkillSetRow {
  return {
    kind: "skill",
    name,
    description,
    source,
    inProject: true,
    on: true,
    changedHere: false,
    ...over,
  };
}

function plugin(id: string, label: string, description = "", skills = 0, over: Partial<SkillSetRow> = {}): SkillSetRow {
  return {
    kind: "plugin",
    name: id,
    label,
    description,
    source: "plugin",
    skills,
    inProject: true,
    on: true,
    changedHere: false,
    ...over,
  };
}

describe("groupRows", () => {
  it("lays rows out in the four-source order and drops empty groups", () => {
    const rows: SkillSetRow[] = [
      skill("weft:done", "weft", "Wrap up"),
      skill("tdac", "user", "TDAC"),
      skill("project-lint", "project", "Lint"),
      plugin("ph@ph", "Posthog", "Analytics", 3),
    ];
    expect(groupRows(rows).map((g) => g.title)).toEqual([
      "Weft",
      "This project",
      "Yours · ~/.claude/skills",
      "Plugins",
    ]);
  });

  it("skips groups with no rows after the filter", () => {
    const rows: SkillSetRow[] = [skill("tdac", "user", "TDAC")];
    expect(groupRows(rows).map((g) => g.title)).toEqual(["Yours · ~/.claude/skills"]);
  });

  it("returns an empty list for an empty array", () => {
    expect(groupRows([])).toEqual([]);
  });

  it("filters rows by name, label, and description (trimmed, case-insensitive)", () => {
    const rows: SkillSetRow[] = [
      skill("tdac", "user", "Anything"),
      skill("weft:commit", "weft", "Commit it"),
      plugin("ph@ph", "Posthog", "Real-time analytics", 1),
      skill("lint", "user", "Code lint"),
    ];
    expect(groupRows(rows, "tdac").map((g) => g.title)).toEqual(["Yours · ~/.claude/skills"]);
    expect(groupRows(rows, "Posthog").map((g) => g.title)).toEqual(["Plugins"]);
    expect(groupRows(rows, "analy").map((g) => g.title)).toEqual(["Plugins"]);
    expect(groupRows(rows, "ZZZ").map((g) => g.title)).toEqual([]);
    // Trimmed query.
    expect(groupRows(rows, "  tdac  ").map((g) => g.title)).toEqual(["Yours · ~/.claude/skills"]);
    // Empty query returns everything.
    expect(groupRows(rows, "   ").map((g) => g.title)).toEqual([
      "Weft",
      "Yours · ~/.claude/skills",
      "Plugins",
    ]);
  });

  it("counts on rows per group", () => {
    const rows: SkillSetRow[] = [
      skill("a", "weft", "", { on: true }),
      skill("b", "weft", "", { on: false }),
      skill("c", "user", "", { on: true }),
      skill("d", "user", "", { on: true }),
      plugin("p@m", "P", "", 0, { on: false }),
    ];
    const groups = groupRows(rows);
    const weft = groups.find((g) => g.title === "Weft")!;
    const user = groups.find((g) => g.title === "Yours · ~/.claude/skills")!;
    const plugins = groups.find((g) => g.title === "Plugins")!;
    expect(weft.on).toBe(1);
    expect(user.on).toBe(2);
    expect(plugins.on).toBe(0);
  });
});

describe("skillsOnCount", () => {
  it("counts each on skill as 1", () => {
    const rows: SkillSetRow[] = [
      skill("a", "user", "", { on: true }),
      skill("b", "user", "", { on: true }),
      skill("c", "user", "", { on: false }),
    ];
    expect(skillsOnCount(rows)).toBe(2);
  });

  it("counts each on plugin by its skills count", () => {
    const rows: SkillSetRow[] = [
      plugin("ph@ph", "P", "", 173, { on: true }),
      plugin("tdac@tdac", "Tdac", "", 1, { on: false }),
    ];
    expect(skillsOnCount(rows)).toBe(173);
  });

  it("treats a plugin with no skills count as 0", () => {
    const rowsUndefined: SkillSetRow[] = [plugin("p@m", "P", "", undefined, { on: true })];
    expect(skillsOnCount(rowsUndefined)).toBe(0);
    const rowsNull: SkillSetRow[] = [plugin("p@m", "P", "", null as unknown as number, { on: true })];
    expect(skillsOnCount(rowsNull)).toBe(0);
    const rowsZero: SkillSetRow[] = [plugin("p@m", "P", "", 0, { on: true })];
    expect(skillsOnCount(rowsZero)).toBe(0);
  });

  it("is zero for an empty array", () => {
    expect(skillsOnCount([])).toBe(0);
  });
});

describe("skillsOffCount", () => {
  it("counts each off skill as 1", () => {
    const rows: SkillSetRow[] = [
      skill("a", "user", "", { on: true }),
      skill("b", "user", "", { on: false }),
      skill("c", "user", "", { on: false }),
    ];
    expect(skillsOffCount(rows)).toBe(2);
  });

  it("counts each off plugin by its skills count", () => {
    const rows: SkillSetRow[] = [
      plugin("ph@ph", "P", "", 173, { on: false }),
      plugin("tdac@tdac", "Tdac", "", 1, { on: true }),
    ];
    expect(skillsOffCount(rows)).toBe(173);
  });

  it("treats a plugin with no skills count as 0", () => {
    const rowsUndefined: SkillSetRow[] = [plugin("p@m", "P", "", undefined, { on: false })];
    expect(skillsOffCount(rowsUndefined)).toBe(0);
    const rowsNull: SkillSetRow[] = [plugin("p@m", "P", "", null as unknown as number, { on: false })];
    expect(skillsOffCount(rowsNull)).toBe(0);
    const rowsZero: SkillSetRow[] = [plugin("p@m", "P", "", 0, { on: false })];
    expect(skillsOffCount(rowsZero)).toBe(0);
  });

  it("is zero for an empty array", () => {
    expect(skillsOffCount([])).toBe(0);
  });
});

describe("withToggled", () => {
  it("leaves non-matching rows untouched", () => {
    const rows: SkillSetRow[] = [
      skill("a", "user", "", { on: true, inProject: true }),
      skill("b", "user", "", { on: false, inProject: true }),
    ];
    const out = withToggled(rows, "a", false, true);
    expect(out[0]).toMatchObject({ name: "a", on: false, inProject: true });
    expect(out[1]).toMatchObject({ name: "b", on: false, inProject: true });
  });

  it("for a project change, inProject follows on", () => {
    const rows: SkillSetRow[] = [skill("a", "user", "", { on: false, inProject: false })];
    expect(withToggled(rows, "a", true, false)).toMatchObject([{ name: "a", on: true, inProject: true }]);
    expect(withToggled(rows, "a", false, false)).toMatchObject([{ name: "a", on: false, inProject: false }]);
  });

  it("for a card change, inProject is preserved; changedHere is true when on differs from inProject", () => {
    // Project-off skill turned on for the card: inProject stays false, on becomes true => changedHere.
    const off: SkillSetRow[] = [skill("a", "user", "", { on: false, inProject: false })];
    expect(withToggled(off, "a", true, true)).toMatchObject([{ name: "a", on: true, inProject: false, changedHere: true }]);
    // Project-on skill turned off for the card: inProject stays true, on becomes false => changedHere.
    const on: SkillSetRow[] = [skill("a", "user", "", { on: true, inProject: true })];
    expect(withToggled(on, "a", false, true)).toMatchObject([{ name: "a", on: false, inProject: true, changedHere: true }]);
    // Card matches the project: changedHere is false even when something moves.
    const same: SkillSetRow[] = [skill("a", "user", "", { on: true, inProject: true })];
    expect(withToggled(same, "a", true, true)).toMatchObject([{ name: "a", on: true, inProject: true, changedHere: false }]);
  });

  it("returns a new array, not the original", () => {
    const rows: SkillSetRow[] = [skill("a", "user", "")];
    expect(withToggled(rows, "a", false, false)).not.toBe(rows);
  });
});

describe("hostSkillView", () => {
  const skills = [
    { name: "ship", description: "Ship it", source: "weft" as const },
    { name: "lint", description: "", source: "project" as const },
    { name: "mine", description: "", source: "user" as const },
  ];

  it("is every skill the host lists, on unless the card turned it off, marked where the card changed it", () => {
    const view = hostSkillView(skills, { skillsOn: ["mine"], skillsOff: ["lint"] });
    expect(view.seeded).toBe(true);
    expect(view.rows.map((r) => [r.name, r.on, r.inProject, r.changedHere])).toEqual([
      ["ship", true, true, false],
      ["lint", false, true, true],
      ["mine", true, false, true],
    ]);
    expect(view.rows[0]).toMatchObject({ kind: "skill", description: "Ship it", source: "weft" });
    expect(hostSkillView(skills, {}).rows.every((r) => r.on && !r.changedHere)).toBe(true);
  });
});
