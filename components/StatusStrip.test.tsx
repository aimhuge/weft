// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanLimits } from "@/lib/plan-limits";

// The strip's two parts: the open thread's numbers, and each CLI's own plan limits from the limits log.

const NOW = 1_800_000_000_000;
let plans: PlanLimits | null = null;
const keys: (string | undefined)[] = [];

vi.mock("./LimitBurndown", () => ({ default: () => null }));
const published = vi.hoisted(() => ({ samples: [] as unknown[], asked: [] as unknown[][] }));
vi.mock("@/lib/use-limit-samples", () => ({
  useLimitSamples: (...args: unknown[]) => (published.asked.push(args), published.samples),
}));
vi.mock("@/lib/use-now", () => ({ useNow: () => NOW }));
vi.mock("@/lib/use-plan-limits", () => ({
  usePlanLimits: (key?: string) => {
    keys.push(key);
    return plans;
  },
}));

const { default: StatusStrip } = await import("./StatusStrip");

const LATER = NOW / 1000 + 3600;
const CLAUDE = { reportedAt: 1, fiveHour: { used: 16 }, sevenDay: { used: 15 } };

afterEach(() => {
  cleanup();
  published.samples = [];
  published.asked.length = 0;
  plans = null;
  keys.length = 0;
});

const text = (ui: React.ReactElement) => render(ui).container.textContent;

describe("StatusStrip", () => {
  it("with no card open, shows every CLI's plan by name and no thread numbers", () => {
    plans = { puku: { reportedAt: 2, fiveHour: { used: 50 } }, claude: CLAUDE };
    expect(text(<StatusStrip />)).toBe("claude5hr:84%7d:85%puku5hr:50%");
  });

  it("with a card open, shows its CLI and model, then only that CLI's plan", () => {
    plans = { claude: CLAUDE, puku: { reportedAt: 2, fiveHour: { used: 50 } } };
    const out = text(
      <StatusStrip backend="claude" cwd="/dev/weft" stats={{ runsOn: { model: "claude-opus-5-5" }, model: "claude-haiku-4-5", contextUsed: 30, branch: "main" }} />,
    );
    expect(out).toBe("weft (main)[claude · opus-5-5]ctx:70%5hr:84%7d:85%");
  });

  it("shows the context stack size next to the percentage", () => {
    const out = text(
      <StatusStrip backend="claude" stats={{ contextUsed: 75, contextTokens: 150_000, contextWindow: 200_000 }} />,
    );
    expect(out).toContain("ctx:25%");
    expect(out).toContain("150.0k/200.0k");
  });

  it("shows the stack size alone when there is no window to measure it against", () => {
    const out = text(<StatusStrip backend="claude" stats={{ contextUsed: 30, contextTokens: 50_000 }} />);
    expect(out).toContain("ctx:70%");
    expect(out).not.toContain("50.0k/");
  });

  it("falls back on the last turn's model, then on the CLI alone", () => {
    expect(text(<StatusStrip backend="puku" stats={{ model: "opus-4.8" }} />)).toContain("[puku · opus-4.8]");
    cleanup();
    expect(text(<StatusStrip stats={{}} />)).toContain("[claude]");
  });

  it("says so when the card's CLI has reported no plan limits", () => {
    plans = { claude: CLAUDE };
    expect(text(<StatusStrip backend="puku" stats={{}} />)).toBe("[puku]no plan limits yet");
  });

  it("reads a window whose reset has passed as full, and shows a reset still ahead", () => {
    plans = { claude: { reportedAt: 1, fiveHour: { used: 100, resetsAt: NOW / 1000 - 60 }, sevenDay: { used: 20, resetsAt: LATER } } };
    const out = text(<StatusStrip backend="claude" />);
    expect(out).toContain("5hr:100%");
    expect(out).toMatch(/7d:80% reset /);
  });

  it("uses the card's own reading where the plans aren't served (the web board)", () => {
    expect(text(<StatusStrip backend="claude" stats={{ fiveHour: { used: 70 } }} />)).toBe("[claude]5hr:30%");
    cleanup();
    expect(text(<StatusStrip stats={{ fiveHour: { used: 70 } }} />)).toBe("[claude]5hr:30%");
    cleanup();
    expect(text(<StatusStrip />)).toBe("");
  });

  it("reads the plans again when the open card gets a new reading", () => {
    render(<StatusStrip backend="claude" stats={{ fiveHour: { used: 70, resetsAt: 5 } }} />);
    expect(keys.at(-1)).toBe("70@5|");
    cleanup();
    render(<StatusStrip />);
    expect(keys.at(-1)).toBeUndefined();
  });

  it("shows a worker card's own reading, never this Mac's limits log, and doesn't ask the log to reload", () => {
    plans = { claude: CLAUDE };
    expect(text(<StatusStrip backend="claude" stats={{ fiveHour: { used: 70 } }} cardLimits />)).toBe("[claude]5hr:30%");
    expect(keys.at(-1)).toBeUndefined();
    cleanup();
    expect(text(<StatusStrip backend="claude" stats={{ fiveHour: { used: 70 } }} />)).toBe("[claude]5hr:84%7d:85%");
  });

  it("on a worker's card, charts that worker's published history and shows its newest reading until the card has one", () => {
    published.samples = [{ at: 1, backend: "claude", kind: "five_hour", used: 40, resetsAt: LATER }];
    const out = text(<StatusStrip backend="claude" cwd="worker://w1/app" stats={{}} cardLimits />);
    expect(out).toContain("5hr:60%");
    expect(published.asked.at(-1)).toEqual(["claude", "w1", false]);
    cleanup();
    // The card's own reading wins once it has one.
    expect(text(<StatusStrip backend="claude" cwd="worker://w1/app" stats={{ fiveHour: { used: 70 } }} cardLimits />)).toContain("5hr:30%");
    cleanup();
    // A local card never asks for a worker's.
    text(<StatusStrip backend="claude" cwd="/dev/app" stats={{ fiveHour: { used: 70 } }} />);
    expect(published.asked.at(-1)).toEqual(["claude", undefined, true]);
  });
});
