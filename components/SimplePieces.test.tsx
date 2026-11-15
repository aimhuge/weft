// @vitest-environment jsdom
import "./test-utils";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boardMode, setBoardMode } from "@/lib/board-prefs";
import { pieceOverride } from "@/lib/simple-mode";

vi.mock("./AppearancePicker", () => ({ default: () => null }));
vi.mock("./UiLanguagePicker", () => ({ default: () => null }));
vi.mock("./HistorySettings", () => ({ default: () => null }));
vi.mock("./AwaySettings", () => ({ default: () => null }));
vi.mock("./DictationSettings", () => ({ default: () => null }));
vi.mock("./SoundSettings", () => ({ default: () => null }));

import SettingsGeneralPage from "./SettingsGeneralPage";
import SimplePieces from "./SimplePieces";

afterEach(() => {
  for (const name of ["weft-board-mode", "weft-simple-three-piles", "weft-simple-pane-full"]) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
});

const box = (name: string) => screen.getByRole<HTMLInputElement>("checkbox", { name });

describe("SimplePieces", () => {
  it("lists the four pieces, on in regular mode and off in advanced", () => {
    render(<SimplePieces />);
    for (const name of ["Full-page pane", "Fold a turn's steps", "One-box new card", "Three piles"]) {
      expect(box(name).checked).toBe(false);
    }
    act(() => setBoardMode("regular"));
    expect(box("Three piles").checked).toBe(true);
  });

  it("keeps a piece apart from the mode, and follows the mode again once ticked back", () => {
    render(<SimplePieces />);
    fireEvent.click(box("Three piles"));
    expect(pieceOverride("three-piles")).toBe(true);
    expect(box("Three piles").checked).toBe(true);
    fireEvent.click(box("Three piles"));
    expect(pieceOverride("three-piles")).toBeUndefined();
    act(() => setBoardMode("regular"));
    fireEvent.click(box("Full-page pane"));
    expect(pieceOverride("pane-full")).toBe(false);
    expect(box("Full-page pane").checked).toBe(false);
  });
});

describe("SettingsGeneralPage's Simple mode switch", () => {
  it("is on in regular mode and flips the board mode", () => {
    const setAdvanced = vi.fn();
    const noop = () => {};
    const { rerender } = render(
      <SettingsGeneralPage backlog={false} setBacklog={noop} progress setProgress={noop} advanced setAdvanced={setAdvanced} />,
    );
    const toggle = screen.getByRole("switch", { name: "Simple mode" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(boardMode()).toBe("regular");
    expect(setAdvanced).toHaveBeenLastCalledWith(false);
    rerender(<SettingsGeneralPage backlog={false} setBacklog={noop} progress setProgress={noop} advanced={false} setAdvanced={setAdvanced} />);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(box("Three piles").checked).toBe(true);
    fireEvent.click(toggle);
    expect(boardMode()).toBe("advanced");
    expect(setAdvanced).toHaveBeenLastCalledWith(true);
  });
});
