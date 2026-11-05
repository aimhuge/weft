// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import PaneTabs, { NewTabButton, tabLabel } from "./PaneTabs";

const settings = { id: 1, url: "http://localhost:3000/settings", title: "Settings" };
const plan = { id: 2, url: "file:///Users/me/.weft/show/plan.html", title: "" };
const tabs = [settings, plan];

describe("tabLabel", () => {
  it("prefers the title, then a short name for the url, then New tab", () => {
    expect(tabLabel(settings)).toBe("Settings");
    expect(tabLabel(plan)).toBe("plan");
    expect(tabLabel({ id: 3, url: "", title: " " })).toBe("New tab");
  });
});

describe("PaneTabs", () => {
  const selectTab = vi.fn();
  const closeTab = vi.fn();
  const newTab = vi.fn();
  beforeEach(() => {
    (window as unknown as { weft: unknown }).weft = { browser: { selectTab, closeTab, newTab } };
  });
  afterEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { weft?: unknown }).weft;
  });

  it("draws nothing for a card with one tab or none", () => {
    const { container, rerender } = render(<PaneTabs tabs={[settings]} current={1} />);
    expect(container.innerHTML).toBe("");
    rerender(<PaneTabs current={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("marks the current tab and selects one on click", () => {
    render(<PaneTabs tabs={tabs} current={1} />);
    expect(screen.getByRole("tab", { name: /Settings/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /plan/ }));
    expect(selectTab).toHaveBeenCalledWith(2);
  });

  it("closes a tab with its × without selecting it, or with a middle click", () => {
    render(<PaneTabs tabs={tabs} current={1} />);
    fireEvent.click(screen.getByLabelText("Close plan"));
    expect(closeTab).toHaveBeenCalledWith(2);
    expect(selectTab).not.toHaveBeenCalled();
    fireEvent(screen.getByRole("tab", { name: /Settings/ }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(closeTab).toHaveBeenLastCalledWith(1);
    fireEvent(screen.getByRole("tab", { name: /Settings/ }), new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(closeTab).toHaveBeenCalledTimes(2);
  });

  it("+ opens a new tab and tells the toolbar", () => {
    const onOpen = vi.fn();
    render(<NewTabButton className="" onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("New tab"));
    expect(newTab).toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalled();
  });

  it("has no + on a shell from before tabs", () => {
    (window as unknown as { weft: unknown }).weft = { browser: {} };
    const { container } = render(<NewTabButton className="" onOpen={() => {}} />);
    expect(container.innerHTML).toBe("");
  });
});
