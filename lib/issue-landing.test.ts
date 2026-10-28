import { describe, expect, it } from "vitest";
import { DEFAULT_LANDING, isIssueLanding, landingColumn, landingRuns, validationMessage, workflowOf } from "./issue-landing";

describe("issue-landing", () => {
  it("knows which values name a landing", () => {
    expect(isIssueLanding("backlog")).toBe(true);
    expect(isIssueLanding("needs_you")).toBe(true);
    expect(isIssueLanding("run")).toBe(true);
    expect(isIssueLanding("Running")).toBe(false);
    expect(isIssueLanding(undefined)).toBe(false);
    expect(isIssueLanding(3)).toBe(false);
  });

  it("reads a folder that chose nothing as the default landing", () => {
    expect(DEFAULT_LANDING).toBe("backlog");
    expect(workflowOf(undefined)).toEqual({ landing: "backlog" });
    expect(workflowOf("backlog")).toEqual({ landing: "backlog" });
    expect(workflowOf({ landing: "nonsense" })).toEqual({ landing: "backlog" });
  });

  it("keeps the skill and the agent a folder named", () => {
    expect(workflowOf({ landing: "run", skill: "weft:plan", agent: "triage" })).toEqual({ landing: "run", skill: "weft:plan", agent: "triage" });
    expect(workflowOf({ landing: "run", skill: "  ", agent: "  " })).toEqual({ landing: "run" });
    expect(workflowOf({ landing: "needs_you", skill: " review " })).toEqual({ landing: "needs_you", skill: "review" });
  });

  it("puts a card in the column its landing names", () => {
    expect(landingColumn("backlog")).toBe("backlog");
    expect(landingColumn("needs_you")).toBe("needs_you");
    // A "run" card waits in Backlog until its thread takes it to Running.
    expect(landingColumn("run")).toBe("backlog");
  });

  it("starts a thread only under the run landing", () => {
    expect(landingRuns("run")).toBe(true);
    expect(landingRuns("backlog")).toBe(false);
    expect(landingRuns("needs_you")).toBe(false);
  });

  it("words the validation skill as the card's first move", () => {
    expect(validationMessage("weft:plan")).toBe("Start by using the weft:plan skill.");
    expect(validationMessage("  weft:plan  ")).toBe("Start by using the weft:plan skill.");
    expect(validationMessage("")).toBeUndefined();
    expect(validationMessage(undefined)).toBeUndefined();
  });
});
