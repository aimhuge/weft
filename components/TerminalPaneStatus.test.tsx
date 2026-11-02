// @vitest-environment jsdom
// A terminal pane's foot shows one line: why the shell couldn't start, else how it exited. The two used to sit on the
// same spot and draw over each other ("Shell exited (-1). Restart" across a worker's refusal).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PaneStatus from "./TerminalPaneStatus";

afterEach(cleanup);

describe("PaneStatus", () => {
  it("shows only the error when there's both, plainly for a worker, with Try again", () => {
    const onRestart = vi.fn();
    const { container } = render(<PaneStatus error="m1mini needs to update before its terminal works here." exited={-1} remote onRestart={onRestart} />);
    expect(container.textContent).toBe("m1mini needs to update before its terminal works here. Try again");
    expect(screen.queryByText(/Shell exited/)).toBeNull();
    fireEvent.click(screen.getByText("Try again"));
    expect(onRestart).toHaveBeenCalled();
  });

  it("says a local shell couldn't start, shows an exit with Restart, and nothing otherwise", () => {
    const onRestart = vi.fn();
    const { container, rerender } = render(<PaneStatus error="no pty" exited={null} remote={false} onRestart={onRestart} />);
    expect(container.textContent).toContain("Couldn't start a shell: no pty");
    rerender(<PaneStatus error={null} exited={1} remote={false} onRestart={onRestart} />);
    fireEvent.click(screen.getByText("Shell exited (1). Restart"));
    expect(onRestart).toHaveBeenCalled();
    rerender(<PaneStatus error={null} exited={null} remote={false} onRestart={onRestart} />);
    expect(container.textContent).toBe("");
  });
});
