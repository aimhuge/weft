// @vitest-environment jsdom
import { fireEvent, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/components/test-utils";
import { useEscape } from "@/lib/use-escape";
import AdminEscape, { isTyping } from "./AdminEscape";

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

  it("ignores other keys", () => {
    render(createElement(AdminEscape));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves the Esc to a drawer open on top of it", () => {
    // The page's own Esc is a layer of the repo's Escape stack (lib/use-escape.ts): a drawer open over it
    // (the Users page's activity drawer) is the newer layer, so it takes the key and the page stays put.
    const drawer = vi.fn();
    render(createElement(AdminEscape));
    renderHook(() => useEscape(true, drawer));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(drawer).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("isTyping", () => {
  const el = (html: string) => {
    const box = document.createElement("div");
    box.innerHTML = html;
    return box.firstElementChild;
  };

  it("counts fields you type into", () => {
    expect(isTyping(el('<input type="text">'))).toBe(true);
    expect(isTyping(el('<input type="search">'))).toBe(true);
    expect(isTyping(el("<input>"))).toBe(true);
    expect(isTyping(el("<textarea></textarea>"))).toBe(true);
  });

  it("leaves out controls you click, so Esc on a ticked filter still goes back", () => {
    expect(isTyping(el('<input type="checkbox">'))).toBe(false);
    expect(isTyping(el('<input type="radio">'))).toBe(false);
    expect(isTyping(el("<select></select>"))).toBe(false);
    expect(isTyping(el("<button></button>"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("AdminEscape on a focused checkbox", () => {
  beforeEach(() => push.mockReset());

  it("goes back to the board", () => {
    render(createElement(AdminEscape));
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.appendChild(box);
    box.focus();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(push).toHaveBeenCalledWith("/");
    box.remove();
  });
});
