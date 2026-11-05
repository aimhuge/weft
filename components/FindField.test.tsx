// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FindField from "./FindField";

afterEach(cleanup);

function field(query = "cat") {
  const props = { query, count: "1 of 3", focus: 1, placeholder: "Find in thread", onQuery: vi.fn(), onStep: vi.fn(), onClose: vi.fn() };
  render(<FindField {...props} />);
  return props;
}

describe("FindField", () => {
  it("takes the focus, and shows where you are", () => {
    field();
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  it("steps with Enter and Shift+Enter, and leaves other keys alone", () => {
    const { onStep } = field();
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(input, { key: "a" });
    expect(onStep.mock.calls).toEqual([[1], [-1]]);
  });

  it("doesn't step with nothing typed, and greys the arrows with no matches", () => {
    const { onStep } = field("");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onStep).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Next match" }).disabled).toBe(true);
  });

  it("types, steps by button and closes", () => {
    const { onQuery, onStep, onClose } = field();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "dog" } });
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    fireEvent.click(screen.getByRole("button", { name: "Close find" }));
    expect(onQuery).toHaveBeenCalledWith("dog");
    expect(onStep.mock.calls).toEqual([[-1], [1]]);
    expect(onClose).toHaveBeenCalled();
  });
});
