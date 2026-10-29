// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { setLocalMenuCover, useAnyOverlay, useMenuCover } from "@/lib/overlay";
import ZoomMenu from "./ZoomMenu";

// The page is a native view drawn above the board, so the zoom menu can't sit on top of it: the pane
// steps the page aside around the menu. The menu must not blank the page the way a dialog does.
describe("ZoomMenu", () => {
  const zoom = vi.fn();
  beforeEach(() => {
    zoom.mockClear();
    (window as unknown as { weft: unknown }).weft = { browser: { zoom } };
  });
  afterEach(() => {
    act(() => setLocalMenuCover(null));
    delete (window as unknown as { weft?: unknown }).weft;
    vi.restoreAllMocks();
  });

  it("opens its menu without raising a full-window overlay", () => {
    function Probe() {
      return <span data-testid="overlay">{useAnyOverlay() ? "hidden" : "shown"}</span>;
    }
    render(
      <>
        <ZoomMenu zoom={50} disabled={false} />
        <Probe />
      </>,
    );
    fireEvent.click(screen.getByLabelText("Page zoom"));
    expect(screen.getByText("Zoom in")).toBeTruthy();
    expect(screen.getByTestId("overlay").textContent).toBe("shown");
  });

  it("publishes the rectangle it covers so the page can step aside", () => {
    // jsdom has no layout, so the menu is given a size to measure.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 976,
      top: 140,
      width: 224,
      height: 320,
      right: 1200,
      bottom: 460,
      x: 976,
      y: 140,
    } as DOMRect);
    const cover = vi.fn();
    function Probe() {
      cover(useMenuCover());
      return null;
    }
    render(
      <>
        <ZoomMenu zoom={50} disabled={false} />
        <Probe />
      </>,
    );
    fireEvent.click(screen.getByLabelText("Page zoom"));
    expect(cover).toHaveBeenLastCalledWith({ x: 976, y: 140, width: 224, height: 320 });
  });

  it("zooms the page when a preset is picked", () => {
    render(<ZoomMenu zoom={50} disabled={false} />);
    fireEvent.click(screen.getByLabelText("Page zoom"));
    fireEvent.click(screen.getByText("150%"));
    expect(zoom).toHaveBeenCalledWith(150);
  });

  it("zooms the page when a step is picked", () => {
    render(<ZoomMenu zoom={100} disabled={false} />);
    fireEvent.click(screen.getByLabelText("Page zoom"));
    fireEvent.click(screen.getByText("Zoom in"));
    expect(zoom).toHaveBeenCalledWith("in");
  });

  it("does nothing while there is no page to zoom", () => {
    render(<ZoomMenu zoom={100} disabled={true} />);
    const button = screen.getByLabelText("Page zoom");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByText("Zoom in")).toBeNull();
  });
});
