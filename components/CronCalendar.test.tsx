// @vitest-environment jsdom
// The ⏰ popover's mini calendar: the month you pick a start day in, the days that will run dotted, and the
// days before today greyed out so they can't be picked.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CronCalendar from "./CronCalendar";
import { NOW } from "./crons.harness";
import "./test-utils";

afterEach(cleanup);

// A day in March 2025 at local midnight.
const day = (n: number) => new Date(2025, 2, n).getTime();
// The day's button is labelled with the browser's own date string.
const label = (n: number) => new Date(day(n)).toDateString();

describe("CronCalendar", () => {
  it("shows the month the start day is in", () => {
    render(<CronCalendar start={day(12)} runs={[]} now={NOW} onPick={vi.fn()} />);
    expect(screen.getByText("March 2025")).toBeInTheDocument();
  });

  it("marks the start day as picked", () => {
    render(<CronCalendar start={day(12)} runs={[]} now={NOW} onPick={vi.fn()} />);
    expect(screen.getByRole("button", { name: label(12) })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: label(13) })).toHaveAttribute("aria-pressed", "false");
  });

  it("picks a day you click", () => {
    const onPick = vi.fn();
    render(<CronCalendar start={day(12)} runs={[]} now={NOW} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: label(20) }));
    expect(onPick).toHaveBeenCalledWith(day(20));
  });

  it("refuses the days before today", () => {
    const onPick = vi.fn();
    render(<CronCalendar start={day(12)} runs={[]} now={NOW} onPick={onPick} />);
    const past = screen.getByRole("button", { name: label(10) });
    expect(past).toBeDisabled();
    fireEvent.click(past);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("dots the days that will run, and not the ones that won't", () => {
    render(<CronCalendar start={day(12)} runs={[day(20), day(21)]} now={NOW} onPick={vi.fn()} />);
    // The dot is a span inside the day's button, so it shows on the run days only.
    const dotted = (n: number) => screen.getByRole("button", { name: label(n) }).querySelector("span");
    expect(dotted(20)).not.toBeNull();
    expect(dotted(21)).not.toBeNull();
    expect(dotted(22)).toBeNull();
  });

  it("doesn't dot the start day twice: the picked day reads as picked", () => {
    const { container } = render(<CronCalendar start={day(20)} runs={[day(20)]} now={NOW} onPick={vi.fn()} />);
    const picked = screen.getByRole("button", { name: label(20) });
    expect(picked.querySelector("span")).toBeNull();
    expect(picked).toHaveAttribute("aria-pressed", "true");
    // March 2025 starts on a Saturday and has 31 days: six weeks, the last one padded.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(6);
  });

  it("walks back and forth through the months", () => {
    render(<CronCalendar start={day(12)} runs={[]} now={NOW} onPick={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("April 2025")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("March 2025")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("February 2025")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("March 2025")).toBeInTheDocument();
  });

  it("steps over the year, in both directions", () => {
    render(<CronCalendar start={new Date(2025, 0, 15).getTime()} runs={[]} now={NOW} onPick={vi.fn()} />);
    expect(screen.getByText("January 2025")).toBeInTheDocument();
    // January minus a month is December of the year before.
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("December 2024")).toBeInTheDocument();
    // December plus a month is January of the year after.
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("February 2025")).toBeInTheDocument();
  });

  it("keeps a day before today disabled whatever month it shows", () => {
    render(<CronCalendar start={day(12)} runs={[]} now={NOW} onPick={vi.fn()} />);
    // Every day of March before the 12th is in the past.
    expect(screen.getByRole("button", { name: label(1) })).toBeDisabled();
    expect(screen.getByRole("button", { name: label(11) })).toBeDisabled();
    expect(screen.getByRole("button", { name: label(12) })).toBeEnabled();
  });
});
