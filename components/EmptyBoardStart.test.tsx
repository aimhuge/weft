// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeCard } from "./test-utils";
import { OPEN_NEW_THREAD } from "@/lib/onboarding-events";
import EmptyBoardStart, { isEmptyBoard } from "./EmptyBoardStart";

// The empty board's start panel, drawn fixed over a plain .board-sheet with a fixed rect.
const flush = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

describe("isEmptyBoard", () => {
  it("is a loaded, unfiltered board with only copilot or archived cards", () => {
    expect(isEmptyBoard([], true, false)).toBe(true);
    expect(isEmptyBoard([makeCard({ archived: true }), makeCard({ role: "copilot" })], true, false)).toBe(true);
    expect(isEmptyBoard([makeCard()], true, false)).toBe(false);
    expect(isEmptyBoard([], false, false)).toBe(false);
    expect(isEmptyBoard([], true, true)).toBe(false);
  });
});

describe("EmptyBoardStart", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main class="board-sheet"></main>';
    document.querySelector<HTMLElement>(".board-sheet")!.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: 500, bottom: 500 }) as DOMRect;
  });

  it("offers New thread and the starters on an empty board", async () => {
    const opened = vi.fn();
    window.addEventListener(OPEN_NEW_THREAD, (e) => void opened((e as CustomEvent<unknown>).detail));
    render(<EmptyBoardStart cards={[]} loaded filtering={false} />, { container: document.body.appendChild(document.createElement("div")) });
    await flush();
    await userEvent.click(screen.getByRole("button", { name: "New thread ⌘N" }));
    await userEvent.click(screen.getByRole("button", { name: /Fix a bug/ }));
    expect(opened).toHaveBeenNthCalledWith(1, {});
    expect(opened).toHaveBeenNthCalledWith(2, { prompt: "Find one real bug in this project and fix it." });
  });

  it("goes away once the first card lands", async () => {
    const view = render(<EmptyBoardStart cards={[]} loaded filtering={false} />, { container: document.body.appendChild(document.createElement("div")) });
    await flush();
    expect(screen.getByText("Start your first thread")).toBeInTheDocument();
    view.rerender(<EmptyBoardStart cards={[makeCard()]} loaded filtering={false} />);
    expect(screen.queryByText("Start your first thread")).toBeNull();
  });
});
