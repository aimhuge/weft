import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Automation, Card } from "./types";

// settings.ts reads ~/.weft; swap in the rules each test wants.
let rules: Automation[] = [];
let model = "";
let effort = "";
vi.mock("./settings", () => ({
  automations: () => rules,
  doneModel: () => model,
  doneEffort: () => effort,
}));

import { doneOverrides, firstMessage, isDoneCommand, messagesForMove, skillsForPrompt } from "./automations";

const card = (over: Partial<Card> = {}) => ({ id: "c1", prompt: "Fix the bug", sessionId: "s1", ...over }) as Card;

beforeEach(() => {
  rules = [];
  model = "";
  effort = "";
});

describe("firstMessage", () => {
  it("is just the prompt with no start rules", () => {
    rules = [{ id: "a", on: "done", skill: "weft:done" }];
    expect(firstMessage(card())).toBe("Fix the bug");
  });

  it("appends one start skill as an instruction", () => {
    rules = [{ id: "a", on: "start", skill: "plan" }];
    expect(firstMessage(card())).toBe("Fix the bug\n\nStart by using the /plan skill.");
  });

  it("lists several start skills in order and drops duplicates", () => {
    rules = [
      { id: "a", on: "start", skill: "plan" },
      { id: "b", on: "start", skill: "weft:preview" },
      { id: "c", on: "start", skill: "plan" },
    ];
    expect(firstMessage(card())).toBe("Fix the bug\n\nStart by using these skills, in order: /plan, /weft:preview.");
  });

  it("ignores rules of other triggers, even when they're listed first", () => {
    rules = [
      { id: "a", on: "done", skill: "weft:done" },
      { id: "b", on: "review", skill: "weft:preview" },
      { id: "c", on: "prompt-matches", skill: "plan", pattern: "." },
    ];
    expect(firstMessage(card())).toBe("Fix the bug");
  });
});

describe("messagesForMove", () => {
  beforeEach(() => {
    rules = [
      { id: "a", on: "done", skill: "weft:done" },
      { id: "b", on: "review", skill: "weft:preview" },
    ];
  });

  it("runs the skills for the column moved into", () => {
    expect(messagesForMove(card(), "done")).toEqual(["/weft:done"]);
    expect(messagesForMove(card(), "review")).toEqual(["/weft:preview"]);
  });

  it("does nothing for other columns", () => {
    for (const column of ["backlog", "running", "needs_you"] as const) {
      expect(messagesForMove(card(), column)).toEqual([]);
    }
  });

  it("does nothing for a card that never ran", () => {
    expect(messagesForMove(card({ sessionId: undefined }), "done")).toEqual([]);
  });

  it("leaves a Claude Code session Weft hasn't run alone", () => {
    expect(messagesForMove(card({ source: "claude-code" }), "done")).toEqual([]);
    expect(messagesForMove(card({ source: "claude-code", lastWeftTurn: 123 }), "done")).toEqual(["/weft:done"]);
  });

  it("treats a Claude Code card with lastWeftTurn=0 as not yet run by Weft", () => {
    // !0 is true, so a never-set lastWeftTurn (defaults to 0) skips automations. This is a sharp
    // edge worth a regression test: a card that *has* been run by Weft gets a real timestamp.
    expect(messagesForMove(card({ source: "claude-code", lastWeftTurn: 0 }), "done")).toEqual([]);
    expect(messagesForMove(card({ source: "claude-code", lastWeftTurn: 1 }), "done")).toEqual(["/weft:done"]);
  });

  it("returns nothing when no rule matches", () => {
    rules = [];
    expect(messagesForMove(card(), "done")).toEqual([]);
  });
});

describe("skillsForPrompt", () => {
  const rule = (over: Partial<Automation> = {}): Automation => ({
    id: "p",
    on: "prompt-matches",
    skill: "vercel:knowledge-update",
    pattern: "vercel|deploy",
    ...over,
  });

  it("returns the skill of a rule whose pattern matches, ignoring case", () => {
    rules = [rule()];
    expect(skillsForPrompt(card(), "Please DEPLOY this")).toEqual(["vercel:knowledge-update"]);
  });

  it("returns nothing when no pattern matches", () => {
    rules = [rule()];
    expect(skillsForPrompt(card(), "Fix the bug")).toEqual([]);
  });

  it("ignores rules of other triggers and rules without a pattern", () => {
    rules = [rule({ on: "done" }), rule({ pattern: undefined }), rule({ pattern: "  " })];
    expect(skillsForPrompt(card(), "vercel deploy")).toEqual([]);
  });

  it("ignores an invalid regex and still applies the other rules", () => {
    rules = [rule({ pattern: "(" }), rule({ id: "q", skill: "plan", pattern: "deploy" })];
    expect(skillsForPrompt(card(), "( deploy")).toEqual(["plan"]);
  });

  it("runs each skill once per thread", () => {
    rules = [rule(), rule({ id: "q", pattern: "vercel" })];
    expect(skillsForPrompt(card(), "vercel")).toEqual(["vercel:knowledge-update"]);
    expect(skillsForPrompt(card({ promptSkills: ["vercel:knowledge-update"] }), "vercel")).toEqual([]);
  });

  it("dedupes matched skills across rules (same skill, different patterns) so each fires once per thread", () => {
    rules = [rule(), rule({ id: "q", pattern: "deploy" })];
    expect(skillsForPrompt(card(), "vercel deploy")).toEqual(["vercel:knowledge-update"]);
  });
});

describe("isDoneCommand", () => {
  it("matches /done and its variants, with or without arguments", () => {
    for (const text of ["/done", " /weft:done ", "/done-quick", "/done ship it"]) expect(isDoneCommand(text)).toBe(true);
  });
  it("ignores other messages", () => {
    for (const text of ["done", "/doner", "/weft:commit", "we're /done"]) expect(isDoneCommand(text)).toBe(false);
  });
});

describe("doneOverrides", () => {
  const claudeCard = (over: Partial<Card> = {}) => card({ backend: "claude", ...over });

  it("returns nothing when the settings are empty", () => {
    expect(doneOverrides(claudeCard())).toEqual({});
  });

  it("returns the model the user picked for a Claude card", () => {
    model = "claude-opus-5-5";
    expect(doneOverrides(claudeCard())).toEqual({ model: "claude-opus-5-5" });
  });

  it("returns the effort the user picked for a Claude card", () => {
    effort = "max";
    expect(doneOverrides(claudeCard())).toEqual({ effort: "max" });
  });

  it("returns both when the user picked both", () => {
    model = "claude-opus-5-5";
    effort = "xhigh";
    expect(doneOverrides(claudeCard())).toEqual({ model: "claude-opus-5-5", effort: "xhigh" });
  });

  it("gives a puku card a Puku model and its effort, stepped down to what puku takes", () => {
    model = "opus-4.8";
    effort = "xhigh";
    expect(doneOverrides(card({ backend: "puku" }))).toEqual({ model: "opus-4.8", effort: "high" });
  });

  it("leaves a card's model alone when the pick is the other CLI's, but still applies the effort", () => {
    model = "claude-opus-5-5";
    effort = "max";
    expect(doneOverrides(card({ backend: "puku" }))).toEqual({ effort: "max" });
    model = "opus-4.8";
    expect(doneOverrides(claudeCard())).toEqual({ effort: "max" });
  });

  it("gives a Goose card the id Goose takes, without the picker's prefix", () => {
    // A Goose row's value carries a "goose:" prefix, so it can't be mistaken for another CLI's
    // same id. The card's model is the id the CLI takes, so the prefix comes off here.
    model = "goose:anthropic/claude-opus-4.1";
    expect(doneOverrides(card({ backend: "goose" }))).toEqual({ model: "anthropic/claude-opus-4.1" });
  });
});
