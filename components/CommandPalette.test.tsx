// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "./test-utils";
import CommandPalette, { type PaletteItem } from "./CommandPalette";

const moved = (i: number): PaletteItem => ({
  id: `moved-${i}`,
  cardId: `c${i}`,
  group: "Recently changed",
  label: `Card ${i}`,
  icon: "file",
  run: () => {},
});

describe("CommandPalette", () => {
  it("opens the rest of the recent moves in place, without closing", async () => {
    const onClose = vi.fn();
    const items = Array.from({ length: 8 }, (_, i) => moved(i));
    render(<CommandPalette items={items} findPrompts={() => Promise.resolve([])} onClose={onClose} />);
    expect(screen.queryByText("Card 7")).toBeNull();
    await userEvent.click(screen.getByText("Show 3 more"));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Card 7")).toBeTruthy();
    expect(screen.queryByText("Show 3 more")).toBeNull();
  });

  it("opens them with Enter too, keeping the highlight on the next card", async () => {
    const items = Array.from({ length: 7 }, (_, i) => moved(i));
    render(<CommandPalette items={items} findPrompts={() => Promise.resolve([])} onClose={() => {}} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "{ArrowUp}{Enter}");
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("Card 5");
  });
});
