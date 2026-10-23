// @vitest-environment jsdom
// components/share-view/PaneFrame.tsx: the loading overlay and the failure state around a shared
// viewer's iframe. The interesting parts are the clock — onLoad hides the overlay, the 12s timeout
// with no load turns into the failure message, and Try again re-mounts the frame.
import "@/components/test-utils";
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANE_FRAME_LOAD_TIMEOUT_MS, PaneFrame } from "./PaneFrame";

const SRC = "https://example.com/docs/";
const FAILED = "This page didn't load.";

function frame(): HTMLIFrameElement {
  const el = document.querySelector("iframe");
  if (!el) throw new Error("no iframe");
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaneFrame", () => {
  it("shows the loading overlay over the frame, and hides it on load", () => {
    render(<PaneFrame src={SRC} title="Shared page" />);
    expect(screen.getByText("Loading the page…")).toBeInTheDocument();
    fireEvent.load(frame());
    expect(screen.queryByText("Loading the page…")).toBeNull();
    // A loaded frame never turns into the failure state.
    act(() => {
      vi.advanceTimersByTime(PANE_FRAME_LOAD_TIMEOUT_MS * 2);
    });
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("shows the failure state when the frame never loads", () => {
    render(<PaneFrame src={SRC} title="Shared page" />);
    act(() => {
      vi.advanceTimersByTime(PANE_FRAME_LOAD_TIMEOUT_MS);
    });
    expect(screen.getByText(FAILED)).toBeInTheDocument();
  });

  it("shows the failure state when the frame errors", () => {
    render(<PaneFrame src={SRC} title="Shared page" />);
    act(() => {
      frame().dispatchEvent(new Event("error"));
    });
    expect(screen.getByText(FAILED)).toBeInTheDocument();
  });

  it("re-mounts the iframe on Try again, with its own clock", () => {
    render(<PaneFrame src={SRC} title="Shared page" />);
    const before = frame();
    act(() => {
      vi.advanceTimersByTime(PANE_FRAME_LOAD_TIMEOUT_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    // A new node: React remounted it, so the browser reloads the src.
    expect(frame()).not.toBe(before);
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.getByText("Loading the page…")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(PANE_FRAME_LOAD_TIMEOUT_MS);
    });
    expect(screen.getByText(FAILED)).toBeInTheDocument();
  });

  it("offers the Open link only when openHref is given", () => {
    const { rerender } = render(<PaneFrame src={SRC} title="Shared page" />);
    act(() => {
      vi.advanceTimersByTime(PANE_FRAME_LOAD_TIMEOUT_MS);
    });
    expect(screen.queryByRole("link", { name: /Open/ })).toBeNull();
    rerender(<PaneFrame src={SRC} title="Shared page" openHref={SRC} />);
    const open = screen.getByRole("link", { name: /Open/ });
    expect(open).toHaveAttribute("href", SRC);
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("hands the iframe to the caller's ref (SharedApp's bridge posts into it)", () => {
    const ref = createRef<HTMLIFrameElement>();
    render(<PaneFrame src={SRC} title="Shared page" frameRef={ref} sandbox="allow-scripts" />);
    expect(ref.current).toBe(frame());
    expect(frame()).toHaveAttribute("sandbox", "allow-scripts");
  });
});
