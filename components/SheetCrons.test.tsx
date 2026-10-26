// @vitest-environment jsdom
// The ⏰ Crons band at the foot of the list view: one row per cron — its name, whether it's on and when it
// runs next, its schedule, how each run starts, its folder, and when it last ran. A click on its status
// runs it now or switches it on or off; its toggle folds open the cards its runs made.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CronRow } from "@/lib/list-crons";
import SheetCrons from "./SheetCrons";
import { fakeCronRun, fakeCronUpdate } from "./crons.harness";
import type { RowNest } from "./CardRowCells";
import { makeCard } from "./test-utils";
import "./test-utils";

afterEach(cleanup);

const NOW = new Date(2025, 2, 12, 9, 0, 0, 0).getTime();

const cron = (over: Partial<CronRow["cron"]> = {}): CronRow["cron"] => ({
  id: "k1",
  name: "Nightly sweep",
  prompt: "sweep the repo",
  expr: "0 9 * * *",
  mode: "fork",
  cwd: "/Users/me/dev/weft",
  backend: "claude",
  permissionMode: "default",
  enabled: true,
  by: "you",
  count: 2,
  runs: [],
  nextAt: NOW + 3_600_000,
  createdAt: NOW - 86_400_000,
  updatedAt: NOW,
  ...over,
});

const row = (over: Partial<CronRow> = {}): CronRow => ({ cron: cron(), runs: [], ...over });

function setup(over: Partial<React.ComponentProps<typeof SheetCrons>> = {}) {
  const props: React.ComponentProps<typeof SheetCrons> = {
    rows: [row()],
    collapsed: false,
    onFold: vi.fn(),
    now: NOW,
    crons: { update: fakeCronUpdate(), run: fakeCronRun() },
    renderRow: (card) => <span>row: {card.title}</span>,
    ...over,
  };
  return { props, view: render(<SheetCrons {...props} />) };
}

describe("SheetCrons", () => {
  it("shows nothing when there are no crons", () => {
    const { view } = setup({ rows: [] });
    expect(view.container).toBeEmptyDOMElement();
  });

  it("says the band's name and how many crons it holds", () => {
    const { view } = setup();
    expect(view.getByText("Crons")).toBeInTheDocument();
    expect(view.getByText("1")).toBeInTheDocument();
  });

  it("says how many of the crons are on", () => {
    const { view } = setup({ rows: [row(), row({ cron: cron({ id: "k2", name: "Off one", enabled: false }) })] });
    expect(view.getByText("1 on")).toBeInTheDocument();
  });

  it("says a cron with no next run isn't on", () => {
    const { view } = setup({ rows: [row({ cron: cron({ enabled: true, nextAt: undefined }) })] });
    expect(view.getByText("0 on")).toBeInTheDocument();
  });

  it("folds and unfolds the band", () => {
    const onFold = vi.fn();
    const { view } = setup({ onFold });
    fireEvent.click(view.getByRole("button", { name: /Crons/ }));
    expect(onFold).toHaveBeenCalled();
  });

  it("says a folded band is folded", () => {
    const { view } = setup({ collapsed: true });
    expect(view.getByText(/folded · click to show/)).toBeInTheDocument();
    expect(view.getByRole("button", { name: /Crons/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("says an open band is open", () => {
    const { view } = setup();
    expect(view.getByRole("button", { name: /Crons/ })).toHaveAttribute("aria-expanded", "true");
    expect(view.queryByText(/folded · click to show/)).toBeNull();
  });

  it("hides the crons when the band is folded", () => {
    const { view } = setup({ collapsed: true });
    expect(view.queryByText("Nightly sweep")).toBeNull();
  });

  it("says the cron's name", () => {
    const { view } = setup();
    expect(view.getByText("Nightly sweep")).toBeInTheDocument();
  });

  it("says the cron's prompt on its name", () => {
    const { view } = setup();
    expect(view.getByTitle("sweep the repo")).toBeInTheDocument();
  });

  it("says the cron's schedule", () => {
    const { view } = setup();
    expect(view.getByTitle("0 9 * * *")).toHaveTextContent("every day at 9:00");
  });

  it("says a fork runs as a fork", () => {
    const { view } = setup();
    expect(view.getByText("fork")).toBeInTheDocument();
  });

  it("says a fresh run is fresh", () => {
    const { view } = setup({ rows: [row({ cron: cron({ mode: "fresh" }) })] });
    expect(view.getByText("fresh")).toBeInTheDocument();
  });

  it("says when a thread made the cron", () => {
    const { view } = setup({ rows: [row({ cron: cron({ by: "thread" }) })] });
    expect(view.getByText("by a thread")).toBeInTheDocument();
  });

  it("doesn't say a thread made a cron you made", () => {
    const { view } = setup();
    expect(view.queryByText("by a thread")).toBeNull();
  });

  it("says the folder the cron runs in", () => {
    const { view } = setup();
    expect(view.getByTitle("/Users/me/dev/weft")).toHaveTextContent("weft");
  });

  it("says when the cron last ran", () => {
    const { view } = setup({ rows: [row({ cron: cron({ runs: [{ cardId: "c1", n: 1, at: NOW - 7_200_000 }] }) })] });
    expect(view.getByText("2h")).toBeInTheDocument();
  });

  it("says how many times it has run", () => {
    const { view } = setup();
    expect(view.getByTitle("2 runs so far")).toHaveTextContent("2×");
  });

  it("has no fold toggle for a cron with no runs", () => {
    const { view } = setup();
    expect(view.queryByRole("button", { name: /runs of Nightly sweep/ })).toBeNull();
  });

  it("folds open the cards a cron's runs made", () => {
    const run = makeCard({ id: "r1", title: "A run", column: "done" });
    const { view } = setup({ rows: [row({ runs: [run] })] });
    fireEvent.click(view.getByRole("button", { name: "Show the runs of Nightly sweep" }));
    expect(view.getByText("row: A run")).toBeInTheDocument();
  });

  it("draws a run as a row nested under its cron", () => {
    const run = makeCard({ id: "r1", title: "A run", column: "done" });
    let nest: RowNest | undefined;
    const { view } = setup({
      rows: [row({ runs: [run] })],
      renderRow: (card, column, n) => {
        nest = n;
        return <span>row: {card.title}</span>;
      },
    });
    fireEvent.click(view.getByRole("button", { name: "Show the runs of Nightly sweep" }));
    expect(nest?.depth).toBe(1);
    expect(nest?.kids).toBe(0);
    expect(nest?.expanded).toBe(false);
    // The run's own toggle does nothing: a run folds nothing under it.
    expect(() => nest?.onToggle()).not.toThrow();
  });

  it("folds the runs back away", () => {
    const run = makeCard({ id: "r1", title: "A run", column: "done" });
    const { view } = setup({ rows: [row({ runs: [run] })] });
    fireEvent.click(view.getByRole("button", { name: "Show the runs of Nightly sweep" }));
    fireEvent.click(view.getByRole("button", { name: "Fold the runs of Nightly sweep" }));
    expect(view.queryByText("row: A run")).toBeNull();
  });

  it("draws a cron as a cron row", () => {
    const { view } = setup();
    expect(view.container.querySelector("[data-cron-row]")).not.toBeNull();
  });

  it("says an on cron is on, and when it next runs", () => {
    const { view } = setup();
    expect(view.getByText("On · in 1h")).toBeInTheDocument();
  });

  it("says a cron that's off is off", () => {
    const { view } = setup({ rows: [row({ cron: cron({ enabled: false }) })] });
    expect(view.getByText("Off")).toBeInTheDocument();
  });

  it("says a cron with no next run is off", () => {
    const { view } = setup({ rows: [row({ cron: cron({ nextAt: undefined }) })] });
    expect(view.getByText("Off")).toBeInTheDocument();
  });

  it("opens the cron's menu on a click", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    expect(view.getByRole("menuitem", { name: /Run now/ })).toBeInTheDocument();
  });

  it("opens the cron's menu on a right-click", () => {
    const { view } = setup();
    fireEvent.contextMenu(view.getByLabelText("Nightly sweep: run or switch"));
    expect(view.getByRole("menuitem", { name: /Run now/ })).toBeInTheDocument();
  });

  it("runs the cron now", () => {
    const run = fakeCronRun();
    const { view } = setup({ crons: { update: fakeCronUpdate(), run } });
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    fireEvent.click(view.getByRole("menuitem", { name: /Run now/ }));
    expect(run).toHaveBeenCalledWith("k1");
  });

  it("offers to switch a cron off", () => {
    const update = fakeCronUpdate();
    const { view } = setup({ crons: { update, run: fakeCronRun() } });
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    fireEvent.click(view.getByRole("menuitem", { name: /Switch off/ }));
    expect(update).toHaveBeenCalledWith("k1", { enabled: false });
  });

  it("offers to switch a cron on", () => {
    const update = fakeCronUpdate();
    const { view } = setup({ rows: [row({ cron: cron({ enabled: false }) })], crons: { update, run: fakeCronRun() } });
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    fireEvent.click(view.getByRole("menuitem", { name: /Switch on/ }));
    expect(update).toHaveBeenCalledWith("k1", { enabled: true });
  });

  it("says what switching a cron off does", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    expect(view.getByText("No more runs until you switch it back")).toBeInTheDocument();
  });

  it("says what switching a cron on does", () => {
    const { view } = setup({ rows: [row({ cron: cron({ enabled: false }) })] });
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    expect(view.getByText("Runs on its schedule again")).toBeInTheDocument();
  });

  it("says why a run failed", async () => {
    const notify = vi.fn();
    const { view } = setup({ notify, crons: { update: fakeCronUpdate(), run: vi.fn(() => Promise.reject(new Error("no CLI"))) } });
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    fireEvent.click(view.getByRole("menuitem", { name: /Run now/ }));
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
  });

  it("closes the cron's menu when the popover closes", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.queryByRole("menu")).toBeNull();
  });

  it("says why a switch failed", async () => {
    const notify = vi.fn();
    const { view } = setup({ notify, crons: { update: vi.fn(() => Promise.reject(new Error("no"))), run: fakeCronRun() } });
    fireEvent.click(view.getByLabelText("Nightly sweep: run or switch"));
    fireEvent.click(view.getByRole("menuitem", { name: /Switch off/ }));
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
  });
});
