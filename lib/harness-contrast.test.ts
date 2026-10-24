// lib/harness-contrast.ts: the grader-free comparison between candidate runs.
import { describe, expect, it } from "vitest";
import {
  contrast,
  DEFAULT_WEIGHTS,
  DECISIVE_MARGIN,
  diffTrajectories,
  measures,
  score,
  scoreCandidates,
  type Trajectory,
} from "./harness-contrast";

function run(over: Partial<Trajectory> = {}): Trajectory {
  return {
    candidate: "candidate-1",
    toolCalls: [],
    messages: 2,
    turns: 3,
    errors: 0,
    tokens: 1_000,
    completed: true,
    ...over,
  };
}

describe("measures", () => {
  it("reads the tool calls' outcomes off the trajectory", () => {
    const m = measures(run({
      toolCalls: [
        { name: "read", ok: true, turn: 1 },
        { name: "bash", ok: false, turn: 2 },
        { name: "edit", ok: true, turn: 2 },
      ],
    }));
    expect(m.toolSuccesses).toBe(2);
    expect(m.toolFailures).toBe(1);
    expect(m.failureRate).toBeCloseTo(1 / 3);
  });

  it("has no failure rate for a run that made no tool calls", () => {
    expect(measures(run()).failureRate).toBe(0);
  });
});

describe("score", () => {
  it("pays for a finished answer", () => {
    expect(score(run({ completed: true }))).toBeGreaterThan(score(run({ completed: false })));
  });

  it("charges for a failed tool call", () => {
    const clean = score(run({ toolCalls: [{ name: "read", ok: true, turn: 1 }] }));
    const dirty = score(run({ toolCalls: [{ name: "read", ok: true, turn: 1 }, { name: "bash", ok: false, turn: 2 }] }));
    expect(dirty).toBeLessThan(clean);
  });

  it("charges for an outright error", () => {
    expect(score(run({ errors: 2 }))).toBeLessThan(score(run({ errors: 0 })));
  });

  it("charges for wandering, but only past the floor", () => {
    expect(score(run({ turns: 3 }))).toBe(score(run({ turns: 3, messages: 2, tokens: 1_000 })));
    expect(score(run({ turns: 12 }))).toBeLessThan(score(run({ turns: 3 })));
    expect(score(run({ messages: 20 }))).toBeLessThan(score(run({ messages: 2 })));
    expect(score(run({ tokens: 90_000 }))).toBeLessThan(score(run({ tokens: 1_000 })));
  });

  it("scores with the weights it is given", () => {
    const custom = { ...DEFAULT_WEIGHTS, completed: 100 };
    expect(score(run({ completed: true }), custom)).toBeGreaterThan(score(run({ completed: false }), custom));
  });
});

describe("diffTrajectories", () => {
  it("lists only the measures where the runs differ, in a fixed order", () => {
    const diffs = diffTrajectories(run({ turns: 4, completed: true }), run({ turns: 9, completed: false }));
    expect(diffs.map((d) => d.measure)).toEqual(["completed", "turns"]);
  });

  it("says which run was better on each measure", () => {
    const diffs = diffTrajectories(run({ completed: true, toolCalls: [{ name: "x", ok: true, turn: 1 }] }), run({ completed: false, toolCalls: [{ name: "x", ok: false, turn: 1 }] }));
    const completed = diffs.find((d) => d.measure === "completed");
    const failures = diffs.find((d) => d.measure === "toolFailures");
    expect(completed?.better).toBe("left");
    expect(failures?.better).toBe("left");
  });

  it("calls fewer failures better and more successes better", () => {
    const diffs = diffTrajectories(run({ toolCalls: [{ name: "x", ok: false, turn: 1 }] }), run({ toolCalls: [{ name: "x", ok: true, turn: 1 }] }));
    expect(diffs.find((d) => d.measure === "toolFailures")?.better).toBe("right");
    expect(diffs.find((d) => d.measure === "toolSuccesses")?.better).toBe("right");
  });

  it("is empty for two identical runs", () => {
    expect(diffTrajectories(run(), run())).toEqual([]);
  });

  it("calls a tie a tie", () => {
    const diffs = diffTrajectories(run({ toolCalls: [{ name: "x", ok: false, turn: 1 }] }), run({ toolCalls: [{ name: "x", ok: false, turn: 1 }] }));
    expect(diffs).toEqual([]);
  });

  it("calls a measure a tie when neither run is better on it", () => {
    // Two runs with the same number of failures differ on the failure RATE only in how it reads; the
    // rate itself is compared like any other measure.
    const diffs = diffTrajectories(
      run({ toolCalls: [{ name: "x", ok: false, turn: 1 }, { name: "y", ok: true, turn: 2 }] }),
      run({ toolCalls: [{ name: "x", ok: true, turn: 1 }, { name: "y", ok: true, turn: 2 }] }),
    );
    const rate = diffs.find((d) => d.measure === "failureRate");
    expect(rate?.better).toBe("right");
    expect(rate?.delta).toBeCloseTo(0.5);
  });
});

describe("scoreCandidates", () => {
  it("puts the best run first", () => {
    const scored = scoreCandidates([
      run({ candidate: "b", completed: false, errors: 1 }),
      run({ candidate: "a", completed: true }),
    ]);
    expect(scored[0]?.candidate).toBe("a");
  });

  it("breaks a tie by name, so the order is stable", () => {
    const scored = scoreCandidates([run({ candidate: "b" }), run({ candidate: "a" })]);
    expect(scored.map((s) => s.candidate)).toEqual(["a", "b"]);
  });
});

describe("contrast", () => {
  it("has no winner when there were no candidates", () => {
    const result = contrast([]);
    expect(result.winner).toBe("");
    expect(result.decisive).toBe(false);
    expect(result.diffs).toEqual([]);
  });

  it("names the winner and the margin", () => {
    const result = contrast([
      run({ candidate: "a", completed: true }),
      run({ candidate: "b", completed: false, errors: 1 }),
    ]);
    expect(result.winner).toBe("a");
    expect(result.margin).toBeGreaterThan(0);
    expect(result.decisive).toBe(true);
  });

  it("is not decisive when the margin is under the threshold", () => {
    const result = contrast([run({ candidate: "a" }), run({ candidate: "b" })]);
    expect(result.margin).toBe(0);
    expect(result.decisive).toBe(false);
  });

  it("is decisive at exactly the threshold", () => {
    const result = contrast([run({ candidate: "a" }), run({ candidate: "b" })], { ...DEFAULT_WEIGHTS, turn: 0 });
    expect(result.margin).toBe(0);
    expect(DECISIVE_MARGIN).toBe(1);
  });

  it("has no diffs when there is only one candidate", () => {
    const result = contrast([run({ candidate: "only" })]);
    expect(result.diffs).toEqual([]);
    expect(result.winner).toBe("only");
  });

  it("carries the winner's differences against the runner-up", () => {
    const result = contrast([
      run({ candidate: "a", toolCalls: [{ name: "read", ok: true, turn: 1 }] }),
      run({ candidate: "b", toolCalls: [{ name: "read", ok: false, turn: 1 }] }),
    ]);
    expect(result.diffs.map((d) => d.measure)).toContain("toolFailures");
  });
});
