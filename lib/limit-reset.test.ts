import { describe, expect, it } from "vitest";
import { gateNote, limitNote, modelResetsAt, planWindow, resetFor, threadReset, type ModelLimitView, type PlanSample, type ResetAnswer } from "./limit-reset";

const NOW = new Date(2026, 9, 10, 22, 30).getTime();
const RESET_AT = NOW + 4 * 60 * 60 * 1000;

const sample = (over: Partial<PlanSample> = {}): PlanSample => ({
  backend: "claude",
  kind: "five_hour",
  used: 50,
  at: NOW - 60_000,
  ...over,
});

const modelLimit = (over: Partial<ModelLimitView> = {}): ModelLimitView => ({
  model: "opus",
  at: NOW - 60_000,
  resetsAt: RESET_AT,
  ...over,
});

describe("planWindow", () => {
  it("is undefined when there is no sample", () => {
    expect(planWindow([], "claude", "five_hour", NOW)).toBeUndefined();
  });

  it("ignores samples for other plans and kinds", () => {
    const samples = [
      sample({ backend: "codex" }),
      sample({ kind: "seven_day" }),
    ];
    expect(planWindow(samples, "claude", "five_hour", NOW)).toBeUndefined();
  });

  it("answers with the CLI's own window, and only that one", () => {
    // Each CLI has its own plan (lib/plan-pools.ts): Claude Code runs on Anthropic's subscription and
    // puku-cli bills through Puku's gateway, so a puku reading says nothing about a Claude thread.
    const samples = [sample({ backend: "puku", used: 90, at: NOW - 5_000 })];
    expect(planWindow(samples, "puku", "five_hour", NOW)).toEqual({ used: 90 });
    expect(planWindow(samples, "claude", "five_hour", NOW)).toBeUndefined();
  });

  it("keeps another plan's window out of it", () => {
    const samples = [sample({ backend: "codex", used: 90 })];
    expect(planWindow(samples, "claude", "five_hour", NOW)).toBeUndefined();
    expect(planWindow(samples, "puku", "five_hour", NOW)).toBeUndefined();
  });

  it("returns the newest sample for that backend and kind", () => {
    const samples = [
      sample({ used: 20, at: NOW - 20_000 }),
      sample({ used: 80, at: NOW - 5_000 }),
      sample({ used: 40, at: NOW - 10_000 }),
    ];
    expect(planWindow(samples, "claude", "five_hour", NOW)).toEqual({ used: 80 });
  });

  it("keeps a reset that is still ahead", () => {
    const samples = [sample({ used: 100, resetsAt: RESET_AT / 1000 })];
    expect(planWindow(samples, "claude", "five_hour", NOW)).toEqual({ used: 100, resetsAt: RESET_AT / 1000 });
  });

  it("is undefined when the window's reset has passed", () => {
    const samples = [sample({ used: 100, resetsAt: (NOW - 1) / 1000 })];
    expect(planWindow(samples, "claude", "five_hour", NOW)).toBeUndefined();
  });

  it("keeps a window whose reset time is unknown", () => {
    const samples = [sample({ used: 50 })];
    expect(planWindow(samples, "claude", "five_hour", NOW)).toEqual({ used: 50 });
  });
});

describe("modelResetsAt", () => {
  it("is undefined without a model", () => {
    expect(modelResetsAt(undefined, [modelLimit()], NOW)).toBeUndefined();
  });

  it("is undefined when the model is not in the list", () => {
    expect(modelResetsAt("sonnet", [modelLimit()], NOW)).toBeUndefined();
  });

  it("returns the model's reset while it is ahead", () => {
    expect(modelResetsAt("opus", [modelLimit()], NOW)).toBe(RESET_AT);
  });

  it("is undefined once the model's reset has passed", () => {
    expect(modelResetsAt("opus", [modelLimit({ resetsAt: NOW - 1 })], NOW)).toBeUndefined();
  });
});

describe("resetFor", () => {
  it("is undefined when nothing is spent", () => {
    expect(resetFor("claude", "opus", [sample({ used: 99 })], [], NOW)).toBeUndefined();
  });

  it("prefers the model's own cap over the plan windows", () => {
    const samples = [
      sample({ kind: "seven_day", used: 100, resetsAt: RESET_AT / 1000 }),
      sample({ kind: "five_hour", used: 100, resetsAt: RESET_AT / 1000 }),
    ];
    expect(resetFor("claude", "opus", samples, [modelLimit()], NOW)).toEqual({
      at: RESET_AT,
      kind: "model",
      subject: "opus",
    });
  });

  it("prefers the weekly window over the 5-hour window", () => {
    const samples = [
      sample({ kind: "five_hour", used: 100, resetsAt: RESET_AT / 1000 }),
      sample({ kind: "seven_day", used: 100, resetsAt: RESET_AT / 1000 }),
    ];
    expect(resetFor("claude", undefined, samples, [], NOW)).toEqual({
      at: RESET_AT,
      kind: "seven_day",
      subject: "claude",
    });
  });

  it("uses the 5-hour window when that is the only spent window", () => {
    const samples = [
      sample({ kind: "five_hour", used: 100, resetsAt: RESET_AT / 1000 }),
      sample({ kind: "seven_day", used: 99, resetsAt: RESET_AT / 1000 }),
    ];
    expect(resetFor("claude", undefined, samples, [], NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });

  it("does not count a window that is only 99% used", () => {
    const samples = [sample({ used: 99, resetsAt: RESET_AT / 1000 })];
    expect(resetFor("claude", undefined, samples, [], NOW)).toBeUndefined();
  });

  it("counts a window that is fully used", () => {
    const samples = [sample({ used: 100, resetsAt: RESET_AT / 1000 })];
    expect(resetFor("claude", undefined, samples, [], NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });

  it("does not count a spent window whose reset has passed", () => {
    const samples = [sample({ used: 100, resetsAt: (NOW - 1) / 1000 })];
    expect(resetFor("claude", undefined, samples, [], NOW)).toBeUndefined();
  });

  it("does not count a spent window whose reset time is unknown", () => {
    const samples = [sample({ used: 100 })];
    expect(resetFor("claude", undefined, samples, [], NOW)).toBeUndefined();
  });

  it("doesn't gate a CLI on another plan's spent window", () => {
    // The case from the bug: Claude Code's 5-hour window was spent, and a puku thread — on Puku's own
    // plan, with no Anthropic limit at all — was held behind it with "Start at 2:30am". Changing the
    // model changed nothing, because the limit was never the model's.
    const samples = [sample({ backend: "claude", used: 100, resetsAt: RESET_AT / 1000 })];
    expect(resetFor("puku", undefined, samples, [], NOW)).toBeUndefined();
    expect(resetFor("claude", undefined, samples, [], NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });

  it("doesn't gate a CLI on another plan's spent window", () => {
    const samples = [sample({ backend: "codex", used: 100, resetsAt: RESET_AT / 1000 })];
    expect(resetFor("claude", undefined, samples, [], NOW)).toBeUndefined();
    expect(resetFor("puku", undefined, samples, [], NOW)).toBeUndefined();
  });

  it("unblocks when the model changes and the new model has no cap of its own", () => {
    // The case from the bug: Opus ran out on its own weekly cap, the user picks Sonnet, and the
    // dialog still said "at its limit" — because the cap was filed as a plan window, which gates
    // every model on the account.
    //
    // A per-model cap is recorded in the model store and never in the plan log (lib/limit-kind.ts),
    // so the plan windows here are the plan's own: the 5-hour one, which every model shares. With
    // that one spent, no model can start — which is right, and is why the fix is at the recording
    // site rather than here.
    const samples = [sample({ kind: "five_hour", used: 100, resetsAt: RESET_AT / 1000 })];
    expect(resetFor("claude", "opus", samples, [modelLimit()], NOW)).toEqual({
      at: RESET_AT,
      kind: "model",
      subject: "opus",
    });
    expect(resetFor("claude", "sonnet", samples, [modelLimit()], NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });

  it("unblocks a different model when only the old model's cap was spent", () => {
    // The case that matters: Opus hit its own weekly cap and the user picks Sonnet. Nothing else
    // is spent, so Sonnet starts now. Before the fix the cap was filed as a plan window and
    // Sonnet was held for the reset too.
    expect(resetFor("claude", "opus", [], [modelLimit()], NOW)).toEqual({
      at: RESET_AT,
      kind: "model",
      subject: "opus",
    });
    expect(resetFor("claude", "sonnet", [], [modelLimit()], NOW)).toBeUndefined();
  });
});

describe("limitNote", () => {
  it("is undefined for a model with no live limit", () => {
    expect(limitNote(undefined, [], NOW)).toBeUndefined();
    expect(limitNote("sonnet", [modelLimit()], NOW)).toBeUndefined();
  });

  it("names the limit and the reset time", () => {
    const note = limitNote("opus", [modelLimit()], NOW);
    expect(note).toMatch(/^limit until /);
    expect(note).toContain(new Date(RESET_AT).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  });
});

describe("gateNote", () => {
  const gate = (over: Partial<ResetAnswer> = {}): ResetAnswer => ({
    at: RESET_AT,
    kind: "five_hour",
    subject: "claude",
    ...over,
  });

  it("is undefined without a gate", () => {
    expect(gateNote(undefined)).toBeUndefined();
  });

  it("names the 5-hour and weekly limits", () => {
    expect(gateNote(gate())).toBe("5-hour limit used up");
    expect(gateNote(gate({ kind: "seven_day" }))).toBe("weekly limit used up");
  });

  it("names the model when the model's own cap is spent", () => {
    expect(gateNote(gate({ kind: "model", subject: "opus" }), "Opus 4.1")).toBe("Opus 4.1 hit its limit");
    expect(gateNote(gate({ kind: "model", subject: "opus" }))).toBe("opus hit its limit");
  });
});

describe("threadReset", () => {
  // A running thread carries its own last reading of its CLI's window; the shared stores know the
  // model's own cap and the CLI's weekly window.
  it("is undefined when nothing is spent", () => {
    expect(threadReset(undefined, undefined, "claude", "opus", [], [], NOW)).toBeUndefined();
  });

  it("uses the thread's own window when it says the window is spent", () => {
    const own = { used: 100, resetsAt: RESET_AT / 1000 };
    expect(threadReset(own, undefined, "claude", "opus", [], [], NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });

  it("falls back to the plan's next reset when the thread's window has no reset time", () => {
    expect(threadReset({ used: 100 }, RESET_AT, "claude", "opus", [], [], NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });

  it("ignores a thread's window that still has room", () => {
    expect(threadReset({ used: 40 }, undefined, "claude", "opus", [], [], NOW)).toBeUndefined();
  });

  it("answers with the model's own cap first", () => {
    const own = { used: 100, resetsAt: RESET_AT / 1000 };
    expect(threadReset(own, undefined, "claude", "opus", [], [modelLimit()], NOW)).toEqual({
      at: RESET_AT,
      kind: "model",
      subject: "opus",
    });
  });

  it("answers with the CLI's weekly window when it is spent", () => {
    const samples = [sample({ kind: "seven_day", used: 100, resetsAt: RESET_AT / 1000 })];
    expect(threadReset(undefined, undefined, "claude", "opus", samples, [], NOW)).toEqual({
      at: RESET_AT,
      kind: "seven_day",
      subject: "claude",
    });
  });

  it("falls back to the shared answer when the thread's window has a reset that has passed", () => {
    const past = { used: 100, resetsAt: (NOW - 1) / 1000 };
    const samples = [sample({ kind: "five_hour", used: 100, resetsAt: RESET_AT / 1000 })];
    expect(threadReset(past, undefined, "claude", "opus", samples, [], NOW)).toEqual({
      at: RESET_AT,
      kind: "five_hour",
      subject: "claude",
    });
  });
});
