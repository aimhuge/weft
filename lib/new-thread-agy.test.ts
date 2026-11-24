// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  agyValue,
  backendFor,
  bareModel,
  cardModel,
  isAgyValue,
  isModelValue,
  modelFor,
  modelOn,
  resolveModel,
} from "./new-thread";

// Antigravity's models beyond the fixed list: agy serves each account its own (lib/antigravity-models.ts), some under
// other CLIs' names, so a picker gives them the "agy:" prefix and the card keeps the bare id agy's set_model takes.

beforeEach(() => localStorage.clear());

describe("agy: picker values", () => {
  it("marks an id as Antigravity's, and only with an id after the prefix", () => {
    expect(agyValue("claude-sonnet-4-6")).toBe("agy:claude-sonnet-4-6");
    expect(isAgyValue("agy:gpt-oss-120b-medium")).toBe(true);
    expect(isAgyValue("agy:")).toBe(false);
    expect(isAgyValue("claude-sonnet-4-6")).toBe(false);
  });

  it("routes to Antigravity, never to Claude Code or Codex", () => {
    expect(backendFor("agy:claude-sonnet-4-6")).toBe("antigravity");
    expect(resolveModel("agy:gpt-oss-120b-medium")).toEqual({ backend: "antigravity", model: "gpt-oss-120b-medium" });
    expect(backendFor("gemini-3.8-flash-high")).toBe("antigravity");
  });

  it("is a model value every route accepts, and the card keeps the bare id", () => {
    expect(isModelValue("agy:claude-sonnet-4-6")).toBe(true);
    expect(bareModel("agy:claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(bareModel("goose:x")).toBe("x");
    expect(cardModel("agy:claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("remembers a picked agy: value for Antigravity only", () => {
    localStorage.setItem("weft.model.antigravity", "agy:claude-sonnet-4-6");
    expect(modelFor("antigravity")).toBe("agy:claude-sonnet-4-6");
    localStorage.setItem("weft.model.claude", "agy:claude-sonnet-4-6");
    expect(modelFor("claude")).toBe("");
  });
});

describe("modelOn for Antigravity", () => {
  it("runs an agy: value as its bare id on Antigravity, and on nothing else", () => {
    expect(modelOn("antigravity", "agy:claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(modelOn("claude", "agy:claude-sonnet-4-6")).toBeUndefined();
  });

  it("keeps an id no other CLI lists, and its own, but drops another CLI's model and its own sentinel", () => {
    expect(modelOn("antigravity", "claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(modelOn("antigravity", "gemini-3.8-flash-low")).toBe("gemini-3.8-flash-low");
    expect(modelOn("antigravity", "claude-opus-5-5")).toBeUndefined();
    expect(modelOn("antigravity", "puku-ai-2.8")).toBeUndefined();
    expect(modelOn("antigravity", ANTIGRAVITY_DEFAULT_MODEL)).toBeUndefined();
  });
});
