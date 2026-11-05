// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsSearch from "./SettingsSearch";
import "./test-utils";

// The search box in Settings' title bar (components/SettingsSearch.tsx).

const box = () => screen.getByRole("combobox", { name: "Search settings" });

afterEach(() => {
  delete (window as { weft?: unknown }).weft;
});

describe("SettingsSearch", () => {
  it("lists matching sections with their page, and opens the one clicked", async () => {
    const onPick = vi.fn();
    render(<SettingsSearch onPick={onPick} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.type(box(), "trusted");
    const option = screen.getByRole("option", { name: /Trusted folders/ });
    expect(option).toHaveTextContent("Security");
    fireEvent.mouseDown(option);
    expect(onPick).toHaveBeenCalledWith({ page: "security", title: "Trusted folders", pageLabel: "Security" });
    expect(box()).toHaveValue("");
  });

  it("moves the highlight with the arrows and picks it with Enter", async () => {
    const onPick = vi.fn();
    render(<SettingsSearch onPick={onPick} />);
    await userEvent.type(box(), "sleep");
    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    const options = screen.getAllByRole("option");
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseEnter(options[0]!);
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ title: "Sleep at low battery" }));
  });

  it("says when nothing matches, and Enter and the arrows do nothing then", async () => {
    const onPick = vi.fn();
    render(<SettingsSearch onPick={onPick} />);
    await userEvent.type(box(), "zebra{ArrowDown}{Enter}");
    expect(screen.getByText("No setting matches “zebra”")).toBeInTheDocument();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("names a page hit as a page", async () => {
    render(<SettingsSearch onPick={() => {}} />);
    await userEvent.type(box(), "teams");
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(/TeamsPage/);
  });

  it("clears on Escape without letting it reach the dialog, and lets it through once empty", async () => {
    const outside = vi.fn();
    window.addEventListener("keydown", outside);
    render(<SettingsSearch onPick={() => {}} />);
    await userEvent.type(box(), "copilot");
    await userEvent.keyboard("{Escape}");
    expect(box()).toHaveValue("");
    expect(outside).not.toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    await userEvent.keyboard("{Escape}");
    expect(outside).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    window.removeEventListener("keydown", outside);
  });

  it("closes the list when the box loses focus", async () => {
    render(<SettingsSearch onPick={() => {}} />);
    await userEvent.type(box(), "copilot");
    act(() => box().blur());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("focuses on ⌘F, on / outside a field, and on the desktop menu's Find", () => {
    let menu: (action: string) => void = () => {};
    const off = vi.fn();
    (window as { weft?: unknown }).weft = { onMenu: (cb: typeof menu) => ((menu = cb), off) };
    const { unmount } = render(
      <>
        <SettingsSearch onPick={() => {}} />
        <input aria-label="other" />
      </>,
    );
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(box()).toHaveFocus();
    act(() => box().blur());
    fireEvent.keyDown(document.body, { key: "/" });
    expect(box()).toHaveFocus();
    const other = screen.getByRole("textbox", { name: "other" });
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(other).toHaveFocus();
    act(() => menu("terminal"));
    expect(other).toHaveFocus();
    act(() => menu("find"));
    expect(box()).toHaveFocus();
    unmount();
    expect(off).toHaveBeenCalled();
  });
});
