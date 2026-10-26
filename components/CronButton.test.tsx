// @vitest-environment jsdom
// The thread header's ⏰: the crons this thread has, the popover that adds one, and "Repeat from here",
// which opens the same popover on the message you clicked.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cron } from "@/lib/cron-types";
import CronButton, { canForkCard } from "./CronButton";
import { makeCron, NOW } from "./crons.harness";
import { makeCard } from "./test-utils";
import "./test-utils";

const crons = vi.hoisted(() => ({
  list: [] as Cron[],
  create: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/use-crons", () => ({
  useCrons: () => ({ crons: crons.list, error: null, create: crons.create, update: crons.update, remove: crons.remove, run: vi.fn() }),
}));

import { repeatFrom } from "@/lib/cron-events";

beforeEach(() => {
  vi.clearAllMocks();
  crons.list = [];
});

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof CronButton>> = {}) {
  const card = makeCard({ id: "c1", prompt: "Fix the login page", sessionId: "s1" });
  const props: React.ComponentProps<typeof CronButton> = { card, now: NOW, ...over };
  return { card, props, view: render(<CronButton {...props} />) };
}

describe("canForkCard", () => {
  it("forks a claude or puku thread that has run, and nothing else", () => {
    expect(canForkCard(makeCard({ backend: "claude", sessionId: "s" }))).toBe(true);
    expect(canForkCard(makeCard({ backend: "puku", sessionId: "s" }))).toBe(true);
    expect(canForkCard(makeCard({ backend: "claude" }))).toBe(false);
    expect(canForkCard(makeCard({ backend: "codex", sessionId: "s" }))).toBe(false);
  });
});

describe("CronButton", () => {
  it("says the thread has no crons, and opens the form to add one", () => {
    const { view } = setup();
    expect(view.getByLabelText("Crons")).toHaveAttribute("title", "Run this thread on a cron");
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText("⏰ Cron this thread")).toBeInTheDocument();
    expect(view.getByLabelText("What each run sends")).toBeInTheDocument();
  });

  it("counts the crons the thread has", () => {
    crons.list = [makeCron({ id: "k1", sourceId: "c1" }), makeCron({ id: "k2", sourceId: "c1" })];
    const { view } = setup();
    expect(view.getByLabelText("Crons")).toHaveAttribute("title", "2 crons on this thread");
  });

  it("counts one cron in the singular", () => {
    crons.list = [makeCron({ id: "k1", sourceId: "c1" })];
    const { view } = setup();
    expect(view.getByLabelText("Crons")).toHaveAttribute("title", "1 cron on this thread");
  });

  it("lists the thread's crons, and switches one off", () => {
    crons.list = [makeCron({ id: "k1", sourceId: "c1", name: "Nightly sweep" })];
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText("Nightly sweep")).toBeInTheDocument();
    expect(view.getByText(/2 runs/)).toBeInTheDocument();
    fireEvent.click(view.getByRole("switch", { name: "Pause" }));
    expect(crons.update).toHaveBeenCalledWith("k1", { enabled: false });
  });

  it("shows a paused cron as off", () => {
    crons.list = [makeCron({ id: "k1", sourceId: "c1", enabled: false, nextAt: undefined })];
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText(/off/)).toBeInTheDocument();
    expect(view.getByRole("switch", { name: "Turn on" })).toBeInTheDocument();
  });

  it("deletes a cron", () => {
    crons.list = [makeCron({ id: "k1", sourceId: "c1", name: "Nightly sweep" })];
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    fireEvent.click(view.getByLabelText("Delete Nightly sweep"));
    expect(crons.remove).toHaveBeenCalledWith("k1");
  });

  it("offers another cron from a thread that already has one", () => {
    crons.list = [makeCron({ id: "k1", sourceId: "c1", name: "Nightly sweep" })];
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText("+ New cron from the last message")).toBeInTheDocument();
    expect(view.queryByLabelText("What each run sends")).toBeNull();
  });

  it("opens the form to add another cron from the last message", () => {
    crons.list = [makeCron({ id: "k1", sourceId: "c1", name: "Nightly sweep" })];
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    fireEvent.click(view.getByText("+ New cron from the last message"));
    expect(view.getByLabelText("What each run sends")).toBeInTheDocument();
  });

  it("opens the form to add a cron, and closes when it's made", async () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(crons.create).toHaveBeenCalled());
    expect(view.queryByText("⏰ Cron this thread")).toBeNull();
  });

  it("says why a cron can't be made", async () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    // The prompt is empty, so there's nothing for the runs to say.
    fireEvent.change(view.getByLabelText("What each run sends"), { target: { value: "  " } });
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(view.getByText(/Write what each run should do/)).toBeInTheDocument());
    expect(crons.create).not.toHaveBeenCalled();
  });

  it("says a fresh thread starts when the thread can't be forked", () => {
    const { view } = setup({ card: makeCard({ id: "c1", prompt: "Fix it", backend: "codex", sessionId: "s" }) });
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText("Each run starts a fresh thread in this folder")).toBeInTheDocument();
  });

  it("says where a fork starts from, when there is an anchor", () => {
    const { view } = setup({ last: { id: "m1", text: "Fix the login page" } });
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText(/Forks at/)).toBeInTheDocument();
  });

  it("says a fork takes the thread as it is now, with no anchor", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText("Forks the thread as it is now")).toBeInTheDocument();
  });

  it("forks the message you asked to repeat from", async () => {
    const { view } = setup();
    repeatFrom("c1", { id: "m9", text: "the ninth message" });
    await waitFor(() => expect(view.getByLabelText("What each run sends")).toBeInTheDocument());
    expect(view.getByLabelText("What each run sends")).toHaveValue("the ninth message");
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() =>
      expect(crons.create).toHaveBeenCalledWith(expect.objectContaining({ cardId: "c1", fromMessage: "m9", mode: "fork" })),
    );
  });

  it("ignores a repeat from another thread", async () => {
    const { view } = setup();
    repeatFrom("other", { id: "m9", text: "not mine" });
    await Promise.resolve();
    expect(view.queryByLabelText("What each run sends")).toBeNull();
  });

  it("closes on a click outside, and on Escape", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    expect(view.getByText("⏰ Cron this thread")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(view.queryByText("⏰ Cron this thread")).toBeNull();
    fireEvent.click(view.getByLabelText("Crons"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(view.queryByText("⏰ Cron this thread")).toBeNull();
  });

  it("stays open on a click inside it", () => {
    const { view } = setup();
    fireEvent.click(view.getByLabelText("Crons"));
    fireEvent.mouseDown(view.getByText("⏰ Cron this thread"));
    expect(view.getByText("⏰ Cron this thread")).toBeInTheDocument();
  });
});
