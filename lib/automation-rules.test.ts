import { describe, expect, it } from "vitest";
import { readAutomations } from "./automation-rules";

// The rules as Settings → Automations sends them, or a worker's synced settings carry them: one check for both.
describe("readAutomations", () => {
  it("reads each rule, dropping a leading slash and giving a new rule an id", () => {
    const [done, match] = readAutomations([
      { id: "a1", on: "done", skill: "/weft:done" },
      { on: "prompt-matches", skill: "deploy", pattern: " ship it " },
    ]);
    expect(done).toEqual({ id: "a1", on: "done", skill: "weft:done" });
    expect(match).toMatchObject({ on: "prompt-matches", skill: "deploy", pattern: "ship it" });
    expect(match?.id).toBeTruthy();
  });

  it("refuses what isn't a rule", () => {
    expect(() => readAutomations("x")).toThrow("automations must be a list.");
    expect(() => readAutomations([null])).toThrow(/Unknown automation trigger/);
    expect(() => readAutomations([{ on: "done", skill: "" }])).toThrow(/Pick a skill/);
    expect(() => readAutomations([{ on: "prompt-matches", skill: "deploy" }])).toThrow(/Enter a pattern/);
    expect(() => readAutomations([{ on: "prompt-matches", skill: "deploy", pattern: "(" }])).toThrow(/isn't a valid pattern/);
    expect(() => readAutomations([{ on: "prompt-matches", skill: "deploy", pattern: "a".repeat(301) }])).toThrow(/under 300 characters/);
  });
});
