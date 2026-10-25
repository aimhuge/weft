// @vitest-environment jsdom
// The board/list switch in the project bar: two buttons, the one in use lit, and a click picks the
// other layout.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";

import ViewToggle from "./ViewToggle";

afterEach(cleanup);

describe("ViewToggle", () => {
  it("lights the layout in use", () => {
    render(<ViewToggle mode="list" onChange={vi.fn()} />);
    expect(screen.getByLabelText("List")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Board")).toHaveAttribute("aria-pressed", "false");
  });

  it("picks the board layout when clicked", () => {
    const onChange = vi.fn();
    render(<ViewToggle mode="list" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Board"));
    expect(onChange).toHaveBeenCalledWith("board");
  });

  it("picks the list layout when clicked", () => {
    const onChange = vi.fn();
    render(<ViewToggle mode="board" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("List"));
    expect(onChange).toHaveBeenCalledWith("list");
  });
});
