import { beforeEach, describe, expect, it, vi } from "vitest";

// The store of exhausted models writes to ~/.weft, so it is mocked here: a test that really wrote
// there would leave the machine's own model limits behind.
const recorded = vi.hoisted(() => [] as { model: string; at: number; resetsAt?: number }[]);
vi.mock("./model-limit", () => ({
  recordModelLimit: (model: string, at: number, resetsAt?: number) => recorded.push({ model, at, ...(resetsAt !== undefined && { resetsAt }) }),
  modelLimit: () => undefined,
  modelLimits: () => [],
  isModelLimited: () => false,
  limitedModels: () => [],
  clearModelLimit: () => {},
}));

const { modelCapFor, modelFamilyOf, planWindowOf, recordModelCaps } = await import("./limit-kind");

// Which limit a rate-limit event names: the plan's own window, or one model's own cap.
// The plan's windows gate every model on the account; a model's cap gates that model alone, so
// filing one as the other is what left the user stuck at "at its limit" with no way out
// (docs/architecture/limits.md).

describe("planWindowOf", () => {
  it("names the plan's own windows", () => {
    expect(planWindowOf("five_hour")).toBe("five_hour");
    expect(planWindowOf("seven_day")).toBe("seven_day");
  });

  it("names no plan window for a per-model cap", () => {
    // A per-model cap is not the plan's weekly window: filing it as one would gate every model
    // on the account.
    expect(planWindowOf("seven_day_opus")).toBeUndefined();
    expect(planWindowOf("seven_day_sonnet")).toBeUndefined();
  });

  it("names no plan window for the overage windows", () => {
    expect(planWindowOf("overage")).toBeUndefined();
    expect(planWindowOf("seven_day_overage_included")).toBeUndefined();
    expect(planWindowOf(undefined)).toBeUndefined();
  });
});

describe("modelFamilyOf", () => {
  it("names the family a per-model cap is for", () => {
    expect(modelFamilyOf("seven_day_opus")).toBe("opus");
    expect(modelFamilyOf("seven_day_sonnet")).toBe("sonnet");
  });

  it("names no family for a plan window", () => {
    expect(modelFamilyOf("five_hour")).toBeUndefined();
    expect(modelFamilyOf("seven_day")).toBeUndefined();
    expect(modelFamilyOf(undefined)).toBeUndefined();
  });
});

describe("modelCapFor", () => {
  it("records the cap against the card's model when it's the one the cap names", () => {
    expect(modelCapFor("claude-opus-5-5", "seven_day_opus")).toBe("claude-opus-5-5");
    expect(modelCapFor("claude-sonnet-5-5", "seven_day_sonnet")).toBe("claude-sonnet-5-5");
  });

  it("records it for a puku model of the same family", () => {
    // The SDK names the family ("opus"); Weft's ids are per CLI, and puku serves its own.
    expect(modelCapFor("opus-4.8", "seven_day_opus")).toBe("opus-4.8");
  });

  it("leaves a model the cap isn't about alone", () => {
    // A card on Sonnet told about Opus's cap: recording it against Sonnet would gate a model
    // that still has room.
    expect(modelCapFor("claude-sonnet-5-5", "seven_day_opus")).toBeUndefined();
    expect(modelCapFor("claude-opus-5-5", "seven_day_sonnet")).toBeUndefined();
  });

  it("records nothing without a model of the card's own", () => {
    // The CLI's default ran and Weft doesn't name it, so there's nothing to record against.
    expect(modelCapFor(undefined, "seven_day_opus")).toBeUndefined();
    expect(modelCapFor("", "seven_day_opus")).toBeUndefined();
  });

  it("records nothing for a plan window", () => {
    expect(modelCapFor("claude-opus-5-5", "five_hour")).toBeUndefined();
    expect(modelCapFor("claude-opus-5-5", "seven_day")).toBeUndefined();
  });
});

describe("recordModelCaps", () => {
  const NOW = new Date(2026, 9, 10, 22, 30).getTime();
  const RESET = NOW + 4 * 60 * 60 * 1000;
  const resets_at = new Date(RESET).toISOString();

  beforeEach(() => {
    recorded.length = 0;
  });

  it("records a spent per-model window against the card's model", () => {
    recordModelCaps("claude-opus-5-5", { seven_day_opus: { utilization: 100, resets_at } }, NOW);
    expect(recorded.map((r) => [r.model, r.resetsAt])).toEqual([["claude-opus-5-5", RESET]]);
  });

  it("records nothing for a window that still has room", () => {
    recordModelCaps("claude-opus-5-5", { seven_day_opus: { utilization: 40, resets_at } }, NOW);
    expect(recorded).toEqual([]);
  });

  it("records nothing for a model the window isn't about", () => {
    // Opus's cap says nothing about a card running Sonnet.
    recordModelCaps("claude-sonnet-5-5", { seven_day_opus: { utilization: 100, resets_at } }, NOW);
    expect(recorded).toEqual([]);
  });

  it("records a window whose reset has passed as no cap", () => {
    const past = new Date(NOW - 1000).toISOString();
    recordModelCaps("claude-opus-5-5", { seven_day_opus: { utilization: 100, resets_at: past } }, NOW);
    expect(recorded).toEqual([]);
  });

  it("records the server's own per-model rows", () => {
    recordModelCaps("claude-fable-5-1", { model_scoped: [{ display_name: "Fable", utilization: 100, resets_at }] }, NOW);
    expect(recorded.map((r) => [r.model, r.resetsAt])).toEqual([["claude-fable-5-1", RESET]]);
  });

  it("records nothing without a model of the card's own", () => {
    recordModelCaps(undefined, { seven_day_opus: { utilization: 100, resets_at } }, NOW);
    expect(recorded).toEqual([]);
  });
});
