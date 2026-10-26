// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import CardView from "./CardView";
import RestartMark, { restartCardClass } from "./RestartMark";

vi.mock("@/lib/client", () => ({
  api: {
    login: vi.fn(() => Promise.resolve()),
    switchBackend: vi.fn(() => Promise.resolve() as Promise<unknown>),
    clearBreak: vi.fn(() => Promise.resolve()),
    putFirst: vi.fn(() => Promise.resolve()),
    waitPermission: vi.fn(() => Promise.resolve()),
  },
}));

afterEach(cleanup);

const renderCard = (props: Partial<Parameters<typeof CardView>[0]> = {}) =>
  render(<CardView card={makeCard()} now={0} selected={false} onOpen={vi.fn()} {...props} />);

describe("the card that asked for a restart", () => {
  it("is marked, so it stands out in any column", () => {
    renderCard({ restartRequested: true });
    const chip = screen.getByText("Restart asked");
    expect(chip).toBeInTheDocument();
    // The red edge, the same red the header's restart pill uses.
    expect(chip.closest("[data-card-id]")?.className).toContain("restart-asked");
  });

  it("leaves a card that asked for nothing unmarked", () => {
    renderCard();
    expect(screen.queryByText("Restart asked")).not.toBeInTheDocument();
    expect(screen.getByText("Fix the login page").closest("[data-card-id]")?.className).not.toContain("restart-asked");
  });

  it("marks the card class only when a restart was asked for", () => {
    expect(restartCardClass(true)).toBe("restart-asked");
    expect(restartCardClass(false)).toBe("");
  });

  it("draws nothing on its own when no restart was asked for", () => {
    const { container } = render(<RestartMark requested={false} />);
    expect(container.textContent).toBe("");
  });

  it("names the reason in a label a screen reader can read", () => {
    render(<RestartMark requested />);
    expect(screen.getByLabelText("This card asked Weft to restart")).toBeInTheDocument();
  });
});
