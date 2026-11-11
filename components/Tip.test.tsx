// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Tip from "./Tip";
import { setPaneBox } from "@/lib/float-place";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const bubble = () => screen.queryByRole("tooltip");

describe("Tip", () => {
  it("opens on hover and closes at once when the mouse leaves a plain tip", () => {
    render(<Tip text="Hello">trigger</Tip>);
    fireEvent.mouseEnter(screen.getByText("trigger"));
    expect(bubble()?.textContent).toBe("Hello");
    expect(bubble()?.className).toContain("pointer-events-none");
    fireEvent.mouseLeave(screen.getByText("trigger"));
    expect(bubble()).toBeNull();
  });

  it("keeps an interactive tip open while the mouse crosses into it, and takes its clicks", async () => {
    const onClick = vi.fn();
    render(
      <Tip text={<button onClick={onClick}>Go</button>} interactive>
        trigger
      </Tip>,
    );
    const trigger = screen.getByText("trigger");
    fireEvent.mouseEnter(trigger);
    expect(bubble()?.className).not.toContain("pointer-events-none");
    fireEvent.mouseLeave(trigger);
    await act(() => vi.advanceTimersByTimeAsync(100));
    fireEvent.mouseEnter(bubble()!);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledOnce();
    fireEvent.mouseLeave(bubble()!);
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(bubble()).toBeNull();
  });

  it("closes an interactive tip a moment after the mouse leaves it for good", async () => {
    render(
      <Tip text="Hi" interactive>
        trigger
      </Tip>,
    );
    fireEvent.mouseEnter(screen.getByText("trigger"));
    fireEvent.mouseLeave(screen.getByText("trigger"));
    expect(bubble()).not.toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(bubble()).toBeNull();
  });

  it("hands a tip squeezed beside the browser pane to the shell's own window, and hides it on leave", () => {
    const show = vi.fn();
    const hide = vi.fn();
    (window as unknown as { weft: unknown }).weft = { tip: { show, hide } };
    setPaneBox({ x: 60, y: 0, width: 900, height: 700 });
    try {
      render(<Tip text="Weft repo analysis">trigger</Tip>);
      fireEvent.mouseEnter(screen.getByText("trigger"));
      expect(show.mock.calls[0]?.[0]).toBe("Weft repo analysis");
      expect(document.querySelector<HTMLElement>("[role=tooltip]")?.style.visibility).toBe("hidden");
      fireEvent.mouseLeave(screen.getByText("trigger"));
      expect(hide).toHaveBeenCalled();
    } finally {
      setPaneBox(null);
      delete (window as unknown as { weft?: unknown }).weft;
    }
  });
});
