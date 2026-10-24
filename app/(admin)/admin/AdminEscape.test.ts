// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/components/test-utils";
import AdminEscape from "./AdminEscape";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("AdminEscape", () => {
  beforeEach(() => push.mockReset());

  it("goes back to the board on Esc", () => {
    render(createElement(AdminEscape));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(push).toHaveBeenCalledWith("/");
  });

  it("only blurs a focused text field", () => {
    render(createElement(AdminEscape));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it("ignores other keys and an Esc something else handled", () => {
    render(createElement(AdminEscape));
    fireEvent.keyDown(window, { key: "Enter" });
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handled.preventDefault();
    window.dispatchEvent(handled);
    expect(push).not.toHaveBeenCalled();
  });
});
