// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CardMarks from "./CardMarks";
import { makeCard } from "./test-utils";

// The chip that says a thread restarted on its own (lib/limit-resume.ts). Its text says WHY: the
// plan's window reset, or the plan itself changed because the user upgraded it.

afterEach(cleanup);

describe("CardMarks", () => {
  it("shows the auto-resumed chip with the time when a window reset", () => {
    render(<CardMarks card={makeCard({ autoResumedAt: 1_800_000_000_000, autoResumedReason: "reset" })} />);
    expect(screen.getByText(/Auto-resumed/)).toBeTruthy();
  });

  it("says the plan was upgraded when that is why the thread restarted", () => {
    render(<CardMarks card={makeCard({ autoResumedAt: 1_800_000_000_000, autoResumedReason: "upgrade" })} />);
    expect(screen.getByText(/plan upgraded/)).toBeTruthy();
    expect(screen.queryByText(/Auto-resumed/)).toBeNull();
  });

  it("shows no chip when the thread did not restart on its own", () => {
    const { container } = render(<CardMarks card={makeCard()} />);
    expect(container.innerHTML).toBe("");
  });
});
