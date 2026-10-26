// @vitest-environment jsdom
// The rail's ⏰ Crons drawer: every cron, soonest first — its schedule and next run, an on/off switch, its
// last runs as dots, Run now, Edit and Delete, and its name opens the source thread.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CronsDrawer from "./CronsDrawer";
import { fakeCronRun, fakeCronUpdate, makeCron, NOW } from "./crons.harness";
import { makeCard } from "./test-utils";
import "./test-utils";

afterEach(cleanup);

function setup(crons = [makeCron()], over: Partial<React.ComponentProps<typeof CronsDrawer>> = {}) {
  const props: React.ComponentProps<typeof CronsDrawer> = {
    crons,
    update: fakeCronUpdate(),
    remove: vi.fn(() => Promise.resolve()),
    run: fakeCronRun(),
    cards: [],
    onOpenCard: vi.fn(),
    notify: vi.fn(),
    ...over,
  };
  return { props, view: render(<CronsDrawer {...props} />) };
}

describe("CronsDrawer", () => {
  it("says so when there are no crons yet", () => {
    const { view } = setup([]);
    expect(view.getByText(/No crons yet/)).toBeInTheDocument();
  });

  it("lists a cron with its schedule and next run", () => {
    const { view } = setup();
    expect(view.getByText("Nightly sweep")).toBeInTheDocument();
    expect(view.getByText(/every day at 9:00/)).toBeInTheDocument();
    // The next run reads "next <time>": the label is in its own bold run.
    const next = [...view.container.querySelectorAll("p")].find((p) => p.textContent.startsWith("next "));
    expect(next?.querySelector("b")?.textContent ?? null).toBe("Wed 12 Mar, 10:00");
  });

  it("sorts the crons, soonest first", () => {
    const { view } = setup([
      makeCron({ id: "k2", name: "Later", nextAt: NOW + 7_200_000 }),
      makeCron({ id: "k1", name: "Sooner", nextAt: NOW + 3_600_000 }),
    ]);
    const names = [...view.getAllByRole("listitem")].map((li) => li.textContent);
    expect(names.findIndex((n) => n.includes("Sooner"))).toBeLessThan(names.findIndex((n) => n.includes("Later")));
  });

  it("says a paused cron is paused, and one with no runs left has none", () => {
    const { view } = setup([makeCron({ id: "k1", enabled: false })]);
    expect(view.getByText("paused")).toBeInTheDocument();
    cleanup();
    const done = setup([makeCron({ id: "k2", nextAt: undefined })]);
    expect(done.view.getByText("no runs left")).toBeInTheDocument();
  });

  it("switches a cron on and off", () => {
    const { props, view } = setup();
    fireEvent.click(view.getByRole("switch", { name: "Pause Nightly sweep" }));
    expect(props.update).toHaveBeenCalledWith("k1", { enabled: false });
    cleanup();
    const off = setup([makeCron({ id: "k1", enabled: false })]);
    fireEvent.click(off.view.getByRole("switch", { name: "Turn on Nightly sweep" }));
    expect(off.props.update).toHaveBeenCalledWith("k1", { enabled: true });
  });

  it("runs a cron now", () => {
    const { props, view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Run now" }));
    expect(props.run).toHaveBeenCalledWith("k1");
  });

  it("opens the source thread from a cron's name", () => {
    const source = makeCard({ id: "src", title: "The source thread" });
    const { props, view } = setup([makeCron({ sourceId: "src" })], { cards: [source] });
    fireEvent.click(view.getByRole("button", { name: /Nightly sweep/ }));
    expect(props.onOpenCard).toHaveBeenCalledWith(source);
  });

  it("leaves the name dead when the source card is gone", () => {
    const { props, view } = setup([makeCron({ sourceId: "gone" })]);
    const button = view.getByRole("button", { name: /Nightly sweep/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onOpenCard).not.toHaveBeenCalled();
  });

  it("shows the runs as dots, and opens a run's card", () => {
    const runCard = makeCard({ id: "run1", column: "running" });
    const { props, view } = setup(
      [makeCron({ count: 1, runs: [{ cardId: "run1", n: 1, at: NOW - 3_600_000 }] })],
      { cards: [runCard] },
    );
    expect(view.getByText("1 run")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Run 1: running" }));
    expect(props.onOpenCard).toHaveBeenCalledWith(runCard);
  });

  it("says a run whose card is gone has gone", () => {
    const { view } = setup([makeCron({ count: 1, runs: [{ cardId: "gone", n: 1, at: NOW - 3_600_000 }] })]);
    expect(view.getByRole("button", { name: "Run 1: card deleted" })).toBeInTheDocument();
  });

  it("does nothing when a run's card has left the board", () => {
    const { props, view } = setup([makeCron({ count: 1, runs: [{ cardId: "gone", n: 1, at: NOW - 3_600_000 }] })]);
    fireEvent.click(view.getByRole("button", { name: "Run 1: card deleted" }));
    expect(props.onOpenCard).not.toHaveBeenCalled();
  });

  it("shows a failed run's error, and its dot is dead", () => {
    const { view } = setup([
      makeCron({ count: 1, runs: [{ cardId: "", n: 1, at: NOW - 3_600_000, error: "the CLI wasn't there" }] }),
    ]);
    expect(view.getByText("· the CLI wasn't there")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Run 1: failed" })).toBeDisabled();
  });

  it("counts the runs in the singular and the plural", () => {
    const { view } = setup([makeCron({ count: 2, runs: [{ cardId: "r1", n: 1, at: NOW }] })]);
    const line = [...view.container.querySelectorAll("div")].find((d) => d.textContent.startsWith("2 runs"));
    expect(line).toBeDefined();
    cleanup();
    const one = setup([makeCron({ count: 1, runs: [{ cardId: "r1", n: 1, at: NOW }] })]);
    expect(one.view.getByText(/1 run/)).toBeInTheDocument();
  });

  it("deletes a cron once you confirm", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { props, view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Nightly sweep"));
    expect(props.remove).toHaveBeenCalledWith("k1");
    confirm.mockRestore();
  });

  it("keeps the cron when you don't confirm", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { props, view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Delete" }));
    expect(props.remove).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("opens the editor, and saves what you change", async () => {
    const { props, view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    expect(view.getByLabelText("What each run sends")).toBeInTheDocument();
    fireEvent.change(view.getByLabelText("What each run sends"), { target: { value: "sweep twice" } });
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(props.update).toHaveBeenCalledWith("k1", expect.objectContaining({ prompt: "sweep twice" })));
    expect(view.queryByLabelText("What each run sends")).toBeNull();
  });

  it("closes the editor again", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.click(view.getByRole("button", { name: "Close" }));
    expect(view.queryByLabelText("What each run sends")).toBeNull();
  });

  it("shows the error when a change fails", async () => {
    const notify = vi.fn();
    const { view } = setup([makeCron()], { update: vi.fn(() => Promise.reject(new Error("nope"))), notify });
    fireEvent.click(view.getByRole("switch", { name: "Pause Nightly sweep" }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
  });

  it("says why a change can't be saved, and leaves the editor open", async () => {
    const { props, view } = setup([makeCron({ expr: "not a cron" })]);
    fireEvent.click(view.getByRole("button", { name: "Edit" }));
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(view.getByText(/isn't a valid cron|has five fields/)).toBeInTheDocument());
    expect(props.update).not.toHaveBeenCalled();
    expect(view.getByLabelText("What each run sends")).toBeInTheDocument();
  });
});
