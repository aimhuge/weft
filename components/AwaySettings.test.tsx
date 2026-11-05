// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AWAY_COOKIE, arrive, awayPrefs, selectedAway, setAwayOpener } from "@/lib/away-open";
import AwaySettings from "./AwaySettings";
import AwayStackChip from "./AwayStackChip";

afterEach(() => {
  cleanup();
  document.cookie = `${AWAY_COOKIE}=; path=/; max-age=0`;
  setAwayOpener(null);
  act(() => selectedAway(null));
});

describe("AwaySettings", () => {
  it("starts off with the minutes greyed out, and saves the switch and minutes", () => {
    render(<AwaySettings />);
    const toggle = screen.getByRole("switch", { name: /while I'm away/ });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole<HTMLSelectElement>("combobox").disabled).toBe(true);
    fireEvent.click(toggle);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "5" } });
    expect(awayPrefs()).toEqual({ on: true, minutes: 5 });
    expect(screen.getByText("1 minute")).toBeTruthy();
  });
});

describe("AwayStackChip", () => {
  const prefs = { on: true, minutes: 1 };

  it("shows the count on the open card while more wait, and Next opens the next", () => {
    const open = vi.fn();
    setAwayOpener(open);
    const { container, rerender } = render(<AwayStackChip id="a" />);
    act(() => void arrive({ id: "a", selected: null, busy: false, idleMs: 120_000, prefs }));
    expect(container.textContent).toBe("");
    act(() => void arrive({ id: "b", selected: "a", busy: false, idleMs: 120_000, prefs }));
    expect(container.textContent).toContain("1 of 2 waiting");
    rerender(<AwayStackChip id="b" />);
    expect(container.textContent).toBe("");
    rerender(<AwayStackChip id="a" />);
    act(() => void fireEvent.click(screen.getByRole("button")));
    expect(open).toHaveBeenLastCalledWith("b");
  });
});
