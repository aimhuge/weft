// @vitest-environment jsdom
// The little pane under the board/list toggle: it says which view Escape just switched you to, and
// its ✕ closes it.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

import ViewHint from "./ViewHint";

afterEach(cleanup);

describe("ViewHint", () => {
  it("says which view you are in now", () => {
    render(<ViewHint mode="list" onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("List view");
  });

  it("says the board view too", () => {
    render(<ViewHint mode="board" onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Board view");
  });

  it("reminds you that Escape goes back", () => {
    render(<ViewHint mode="board" onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("hit Esc again to switch to list view");
  });

  it("names the view you would go back to, the other way round", () => {
    render(<ViewHint mode="list" onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("hit Esc again to switch to board view");
  });

  it("closes on its ✕", () => {
    const onDismiss = vi.fn();
    render(<ViewHint mode="list" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("is loud: an accent border, a glow and a pop-in", () => {
    render(<ViewHint mode="list" onDismiss={vi.fn()} />);
    const pane = screen.getByRole("status");
    // The first version was the bar's own grey on the bar's own grey and read as a tooltip.
    expect(pane.className).toContain("border-accent");
    expect(pane.className).toContain("view-hint-pop");
  });

  it("sets the view's name in accent, so the eye lands on it", () => {
    render(<ViewHint mode="list" onDismiss={vi.fn()} />);
    const title = screen.getByText("List view");
    expect(title.className).toContain("text-accent");
    expect(title.className).toContain("font-semibold");
  });
});
