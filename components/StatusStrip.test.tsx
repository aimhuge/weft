// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanLimits } from "@/lib/plan-limits";

// The strip's two parts: the open thread's numbers, and each CLI's own plan limits from the limits log.

const NOW = 1_800_000_000_000;
let plans: PlanLimits | null = null;
const keys: (string | undefined)[] = [];

vi.mock("./LimitBurndown", () => ({ default: () => null }));
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
});
