import { describe, expect, it, vi } from "vitest";

// startGate reads the plan log and the model store off disk; both are mocked here so the test
// stays a thin check of how startGate combines them.

vi.mock("./limit-history", () => ({
  readSamples: vi.fn(() => [] as unknown[]),
}));
vi.mock("./model-limit", () => ({
  modelLimits: vi.fn(() => [] as unknown[]),
}));

const history = await import("./limit-history");
const modelStore = await import("./model-limit");
const { startGate } = await import("./start-gate");

const NOW = new Date(2026, 9, 10, 22, 30).getTime();
const RESET_AT = NOW + 4 * 60 * 60 * 1000;

describe("startGate", () => {
  it("returns undefined when nothing is spent", () => {
    expect(startGate("claude", "opus", NOW)).toBeUndefined();
  });

  it("reads both stores at the given time", () => {
    startGate("claude", "opus", NOW);
    expect(history.readSamples).toHaveBeenCalledWith(NOW);
    expect(modelStore.modelLimits).toHaveBeenCalledWith(NOW);
  });

  it("gates on the model's own limit", () => {
    vi.mocked(modelStore.modelLimits).mockReturnValueOnce([
      { model: "opus", at: NOW - 60_000, resetsAt: RESET_AT },
    ]);
    expect(startGate("claude", "opus", NOW)).toEqual({
      at: RESET_AT,
      kind: "model",
      subject: "opus",
    });
  });

  it("gates on the CLI's spent plan window", () => {
    vi.mocked(history.readSamples).mockReturnValueOnce([
      { at: NOW - 60_000, backend: "claude", kind: "five_hour", used: 100, resetsAt: RESET_AT / 1000 },
    ] as never);
    expect(startGate("claude", undefined, NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });
});
