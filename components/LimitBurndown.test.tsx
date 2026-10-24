// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LimitBurndown from "./LimitBurndown";
import type { LimitSample } from "@/lib/limit-chart";
import type { CardStats } from "@/lib/types";

// The chart draws the card's own CLI's plan, but the history behind the plot is the ACCOUNT's: the plan
// limits are one pool per account, shared by every CLI (see the note in useSamples). With days logged
// before the week began, it reaches back into them (lib/limit-chart.ts).

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-23T22:00:00+07:00").getTime();
const WEEKLY_RESET = Math.floor(new Date("2026-10-23T11:00:00+07:00").getTime() / 1000);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function sample(at: number, backend: "claude" | "puku", used: number): LimitSample {
  return { at, backend, kind: "seven_day", used, resetsAt: WEEKLY_RESET };
}

// A fetch that answers with the given samples.
function serves(samples: LimitSample[]) {
  return vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<{ samples: LimitSample[] }> }>>(async () => {
    await Promise.resolve();
    return {
      ok: true,
      json: async () => {
        await Promise.resolve();
        return { samples };
      },
    };
  });
}

describe("LimitBurndown", () => {
  it("reads the account's whole history, and names the card's own CLI's plan", async () => {
    const fetchMock = serves([]);
    vi.stubGlobal("fetch", fetchMock);
    vi.setSystemTime(NOW);
    render(<LimitBurndown stats={{ sevenDay: { used: 14, resetsAt: WEEKLY_RESET } }} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // No ?backend: the plan limits are one pool per account, shared by every CLI, so the chart needs
    // the whole history to reach back into last week. The plan it NAMES is still the card's own CLI's.
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/limits");
    expect(screen.getByText("Claude Code's plan")).toBeTruthy();
    cleanup();
    render(<LimitBurndown backend="puku" stats={{}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/limits");
    expect(screen.getByText("puku-cli's plan")).toBeTruthy();
  });

  it("reaches back into last week when the account's history has those days", async () => {
    // A week of Claude Code readings.
    const history = [
      sample(NOW - 5 * DAY, "claude", 90),
      sample(NOW - 4 * DAY, "claude", 70),
      sample(NOW - 3 * DAY, "claude", 55),
      sample(NOW - 2 * DAY, "claude", 40),
      sample(NOW - DAY, "claude", 30),
      sample(NOW - 3 * 60_000, "claude", 14),
    ];
    const fetchMock = serves(history);
    vi.stubGlobal("fetch", fetchMock);
    vi.setSystemTime(NOW);

    const stats: CardStats = { sevenDay: { used: 14, resetsAt: WEEKLY_RESET } };
    render(<LimitBurndown stats={stats} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const svg = screen.getByRole("img");
    await waitFor(() => {
      const labels = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
      expect(labels).toContain("last week");
    });
    const days = Array.from(svg.querySelectorAll("text"))
      .map((t) => t.textContent)
      .filter((l) => l && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(l));
    expect(days.length).toBe(10);
  });

  it("reaches back into last week for a card on the CLI with the fewest readings", async () => {
    // The bug this chart had: puku had 2 readings, both from today, so filtering by CLI left no history
    // before the week began and the lookback could never fire. The account's history has it.
    const history = [
      sample(NOW - 5 * DAY, "claude", 90),
      sample(NOW - 4 * DAY, "claude", 70),
      sample(NOW - 3 * DAY, "claude", 55),
      sample(NOW - 2 * DAY, "claude", 40),
      sample(NOW - DAY, "claude", 30),
      sample(NOW - 3 * 60_000, "puku", 14),
    ];
    const fetchMock = serves(history);
    vi.stubGlobal("fetch", fetchMock);
    vi.setSystemTime(NOW);

    const stats: CardStats = { sevenDay: { used: 14, resetsAt: WEEKLY_RESET } };
    render(<LimitBurndown backend="puku" stats={stats} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const svg = screen.getByRole("img");
    await waitFor(() => {
      const labels = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
      expect(labels).toContain("last week");
    });
    const days = Array.from(svg.querySelectorAll("text"))
      .map((t) => t.textContent)
      .filter((l) => l && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(l));
    expect(days.length).toBe(10);
  });

  it("shows a plain week when the account's history has nothing before the reset", async () => {
    const history = [sample(NOW - 3 * 60_000, "puku", 14)];
    const fetchMock = serves(history);
    vi.stubGlobal("fetch", fetchMock);
    vi.setSystemTime(NOW);

    const stats: CardStats = { sevenDay: { used: 14, resetsAt: WEEKLY_RESET } };
    render(<LimitBurndown backend="puku" stats={stats} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const svg = screen.getByRole("img");
    await waitFor(() => expect(svg.querySelectorAll("text").length).toBeGreaterThan(0));
    const days = Array.from(svg.querySelectorAll("text"))
      .map((t) => t.textContent)
      .filter((l) => l && /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(l));
    expect(days.length).toBe(7);
  });

  it("draws the 5-hour level standing right now, with its number on it", async () => {
    const fetchMock = serves([]);
    vi.stubGlobal("fetch", fetchMock);
    vi.setSystemTime(NOW);

    // 66% used leaves 34% of the 5-hour window, resetting in two hours.
    const stats: CardStats = {
      fiveHour: { used: 66, resetsAt: Math.floor((NOW + 2 * 60 * 60 * 1000) / 1000) },
      sevenDay: { used: 14, resetsAt: WEEKLY_RESET },
    };
    render(<LimitBurndown stats={stats} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const svg = screen.getByRole("img");
    await waitFor(() => {
      const labels = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
      expect(labels).toContain("34%");
    });
    // The header says the same thing, so the number is in the plot and in the summary.
    expect(screen.getByText(/34% left/)).toBeTruthy();
  });

  it("draws no level once the window has reset, so the plot never shows a stale number", async () => {
    const fetchMock = serves([]);
    vi.stubGlobal("fetch", fetchMock);
    vi.setSystemTime(NOW);

    // The window reset a minute ago: the header reads it as full, and the plot must agree.
    const stats: CardStats = {
      fiveHour: { used: 66, resetsAt: Math.floor((NOW - 60_000) / 1000) },
      sevenDay: { used: 14, resetsAt: WEEKLY_RESET },
    };
    render(<LimitBurndown stats={stats} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const svg = screen.getByRole("img");
    await waitFor(() => expect(svg.querySelectorAll("text").length).toBeGreaterThan(0));
    const labels = Array.from(svg.querySelectorAll("text")).map((t) => t.textContent);
    expect(labels).not.toContain("34%");
    // The header reads the passed window as full.
    expect(screen.getAllByText(/100% left/).length).toBeGreaterThan(0);
  });
});
