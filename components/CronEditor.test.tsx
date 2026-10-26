// @vitest-environment jsdom
// The ⏰ form: what each run sends, whether it forks the thread or starts fresh, how often, from which day
// and until when — and the readback line under it that says what the rule means.

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newForm } from "@/lib/cron-form";
import type { CronForm } from "@/lib/cron-form";
import CronEditor from "./CronEditor";
import { NOW } from "./crons.harness";
import "./test-utils";

afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof CronEditor>> = {}, form: Partial<CronForm> = {}) {
  const props: React.ComponentProps<typeof CronEditor> = {
    initial: { ...newForm("sweep the repo", "fresh", NOW), ...form },
    now: NOW,
    submitLabel: "Create cron",
    onSubmit: vi.fn(),
    ...over,
  };
  return { props, view: render(<CronEditor {...props} />) };
}

describe("CronEditor", () => {
  it("shows what each run sends, and takes what you write", () => {
    const { view } = setup();
    const box = view.getByLabelText("What each run sends");
    expect(box).toHaveValue("sweep the repo");
    fireEvent.change(box, { target: { value: "sweep it twice" } });
    expect(box).toHaveValue("sweep it twice");
  });

  it("leaves its own prompt out when the parent has one above", () => {
    const { view } = setup({ prompt: false });
    expect(view.queryByLabelText("What each run sends")).toBeNull();
  });

  it("offers the fork and fresh choice only for a thread that has run", () => {
    const { view } = setup({ canFork: true });
    expect(view.getByRole("radiogroup", { name: "Each run" })).toBeInTheDocument();
    cleanup();
    const plain = setup();
    expect(plain.view.queryByRole("radiogroup", { name: "Each run" })).toBeNull();
  });

  it("switches between forking and starting fresh", () => {
    const onSubmit = vi.fn();
    const { view } = setup({ canFork: true, onSubmit });
    fireEvent.click(view.getByRole("radio", { name: /Fork from here/ }));
    expect(view.getByRole("radio", { name: /Fork from here/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "fork" }));
  });

  it("picks a preset and says what it means", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Hourly" }));
    expect(view.getByRole("button", { name: "Hourly" })).toHaveAttribute("aria-pressed", "true");
    expect(view.getByText(/every hour at :00/)).toBeInTheDocument();
  });

  it("asks for a minute on the hour, and a time otherwise", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Hourly" }));
    expect(view.getByText("Minute")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Daily" }));
    expect(view.getByText("Time")).toBeInTheDocument();
  });

  it("takes the time you set", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Daily" }));
    fireEvent.change(view.getByLabelText("Time"), { target: { value: "07:45" } });
    expect(view.getByText(/every day at 7:45/)).toBeInTheDocument();
  });

  it("picks the days of the week, and keeps the last one", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Weekly" }));
    const days = view.getByLabelText("Days");
    const [monday, tuesday] = [...days.querySelectorAll("button")];
    // Monday is the one day a new form starts on.
    expect(monday).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tuesday!);
    expect(tuesday).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(monday!);
    expect(monday).toHaveAttribute("aria-pressed", "false");
    // The last day on can't be taken off: there'd be nothing to run.
    fireEvent.click(tuesday!);
    expect(tuesday).toHaveAttribute("aria-pressed", "true");
  });

  it("asks which day of the month on the monthly preset", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Monthly" }));
    const field = view.getByLabelText("Day of the month");
    expect(field).toHaveValue(12);
    fireEvent.change(field, { target: { value: "40" } });
    expect(field).toHaveValue(31);
    fireEvent.change(field, { target: { value: "0" } });
    expect(field).toHaveValue(1);
    fireEvent.change(field, { target: { value: "" } });
    expect(field).toHaveValue(1);
  });

  it("takes a cron string on the custom preset, and says when it won't do", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Custom…" }));
    const field = view.getByLabelText("Cron");
    expect(field).toHaveValue("0 9 * * 1-5");
    fireEvent.change(field, { target: { value: "not a cron" } });
    expect(view.getByText(/isn't a valid cron|has five fields/)).toBeInTheDocument();
  });

  it("keeps a custom cron's own expression when you come back to it", () => {
    const { view } = setup();
    fireEvent.click(view.getByRole("button", { name: "Custom…" }));
    fireEvent.change(view.getByLabelText("Cron"), { target: { value: "30 6 * * *" } });
    fireEvent.click(view.getByRole("button", { name: "Daily" }));
    fireEvent.click(view.getByRole("button", { name: "Custom…" }));
    expect(view.getByLabelText("Cron")).toHaveValue("30 6 * * *");
  });

  it("picks a start day on the calendar", () => {
    const onSubmit = vi.fn();
    const { view } = setup({ onSubmit });
    fireEvent.click(view.getByRole("button", { name: new RegExp(new Date(2025, 2, 20).toDateString()) }));
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ start: new Date(2025, 2, 20).getTime() }));
  });

  it("takes the day it ends on", () => {
    const onSubmit = vi.fn();
    const { view } = setup({ onSubmit });
    const end = view.getByLabelText("Ends");
    expect(end).toHaveValue("");
    fireEvent.change(end, { target: { value: "2025-03-20" } });
    expect(end).toHaveValue("2025-03-20");
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ end: new Date("2025-03-20T00:00").getTime() }));
  });

  it("shows the end day it was given, when the form opens on one", () => {
    const { view } = setup({}, { end: new Date("2025-03-20T00:00").getTime() });
    expect(view.getByLabelText("Ends")).toHaveValue("2025-03-20");
  });

  it("takes the end day back off", () => {
    const { view } = setup({}, { end: new Date("2025-03-20T00:00").getTime() });
    const end = view.getByLabelText("Ends");
    fireEvent.change(end, { target: { value: "" } });
    expect(end).toHaveValue("");
  });

  it("shows an empty custom cron box when the form opens on one with no expression", () => {
    const { view } = setup({}, { pick: { preset: "custom", hour: 9, minute: 0, days: [1], dom: 1 } });
    expect(view.getByLabelText("Cron")).toHaveValue("");
  });

  it("says when each run starts, and lists the runs to come", () => {
    const { view } = setup();
    expect(view.getByText(/each run: a new card and its run page/i)).toBeInTheDocument();
    expect(view.getByText(/next /)).toBeInTheDocument();
  });

  it("takes a footer of its own, and falls back to the default line", () => {
    const { view } = setup({ footer: <span>Also run now</span> });
    expect(view.getByText("Also run now")).toBeInTheDocument();
  });

  it("shows the error the parent raised, and lets you try again", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("It ends before it starts."));
    const { view } = setup({ onSubmit });
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(view.getByText("It ends before it starts.")).toBeInTheDocument());
    // The button comes back, so the form can be sent again.
    expect(view.getByRole("button", { name: "Create cron" })).toBeEnabled();
  });

  it("shows an error that isn't an Error as it is", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce("plain trouble");
    const { view } = setup({ onSubmit });
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(view.getByText("plain trouble")).toBeInTheDocument());
  });

  it("disables the button while it is sending", async () => {
    let done: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
    const { view } = setup({ onSubmit });
    fireEvent.click(view.getByRole("button", { name: "Create cron" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Create cron" })).toBeDisabled());
    done();
    await waitFor(() => expect(view.getByRole("button", { name: "Create cron" })).toBeEnabled());
  });
});
