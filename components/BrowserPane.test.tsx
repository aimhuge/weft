// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { setCopilotLauncher, setCopilotPanel } from "@/lib/copilot-float";
import { setLocalMenuCover, useOverlay } from "@/lib/overlay";
import BrowserPane from "./BrowserPane";

vi.mock("@/lib/use-mini-apps", () => ({ useMiniApps: () => [] }));
vi.mock("./AppShareButton", () => ({ default: () => null }));
vi.mock("./SaveAppButton", () => ({ default: () => null }));

// A full-window overlay, like a dialog: it covers the page, so the page goes away.
function Overlay({ open }: { open: boolean }) {
  useOverlay(open);
  return null;
}

// The page is a native view the shell lays over the placeholder; nothing in the page can cover it, so
// it steps aside (zero bounds) while the copilot's floating peek or chat overlaps it.
describe("BrowserPane and the floating copilot", () => {
  const setBounds = vi.fn();
  beforeEach(() => {
    setBounds.mockClear();
    (window as unknown as { weft: unknown }).weft = { browser: { setBounds } };
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 800, top: 100, width: 400, height: 600 } as DOMRect);
  });
  afterEach(() => {
    act(() => {
      setCopilotPanel(null);
      setCopilotLauncher(null);
    });
    delete (window as unknown as { weft?: unknown }).weft;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const pane = () => (
    <BrowserPane desktop state={{ url: "https://example.com" } as never} obscured={false} expanded={false} width={400} onWidth={() => {}} onClose={() => {}} />
  );

  it("shows the page where the placeholder is while the copilot is out of its way", () => {
    act(() => setCopilotPanel({ x: 100, y: 100, width: 200, height: 200 }));
    render(pane());
    expect(setBounds).toHaveBeenLastCalledWith({ x: 800, y: 100, width: 400, height: 600 });
  });

  it("steps aside while the copilot's panel covers it, and comes back when it closes", () => {
    render(pane());
    act(() => setCopilotPanel({ x: 864, y: 80, width: 400, height: 640 }));
    expect(setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 });
    act(() => {
      setCopilotPanel(null);
      setCopilotLauncher(null);
    });
    expect(setBounds).toHaveBeenLastCalledWith({ x: 800, y: 100, width: 400, height: 600 });
  });

  it("stops short above the launcher when it sits in the pane's corner", () => {
    render(pane());
    act(() => setCopilotLauncher({ x: 1100, y: 600, width: 52, height: 52 }));
    expect(setBounds).toHaveBeenLastCalledWith({ x: 800, y: 100, width: 400, height: 492 });
  });
});

// A local menu (the zoom menu, a card's mode picker) is drawn above the page, so the page steps
// aside around it rather than disappearing under it. A full-window overlay still takes the page away.
describe("BrowserPane and an open menu", () => {
  const setBounds = vi.fn();
  beforeEach(() => {
    setBounds.mockClear();
    (window as unknown as { weft: unknown }).weft = { browser: { setBounds } };
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 800, top: 100, width: 400, height: 600 } as DOMRect);
  });
  afterEach(() => {
    act(() => {
      setCopilotPanel(null);
      setCopilotLauncher(null);
    });
    delete (window as unknown as { weft?: unknown }).weft;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const pane = () => (
    <BrowserPane desktop state={{ url: "https://example.com" } as never} obscured={false} expanded={false} width={400} onWidth={() => {}} onClose={() => {}} />
  );

  it("keeps the page visible and steps it aside around an open menu", () => {
    render(pane());
    // The zoom menu, hanging off the toolbar on the right of the pane.
    act(() => setLocalMenuCover({ x: 976, y: 140, width: 224, height: 320 }));
    // The page keeps the strip below the menu rather than vanishing.
    expect(setBounds).toHaveBeenLastCalledWith({ x: 800, y: 460, width: 400, height: 240 });
  });

  it("gives the whole page back when the menu closes", () => {
    render(pane());
    act(() => setLocalMenuCover({ x: 976, y: 140, width: 224, height: 320 }));
    act(() => setLocalMenuCover(null));
    expect(setBounds).toHaveBeenLastCalledWith({ x: 800, y: 100, width: 400, height: 600 });
  });

  it("still hides the page for a full-window overlay", () => {
    function WithOverlay({ open }: { open: boolean }) {
      return (
        <>
          {pane()}
          <Overlay open={open} />
        </>
      );
    }
    const { rerender } = render(<WithOverlay open={false} />);
    act(() => setLocalMenuCover({ x: 976, y: 140, width: 224, height: 320 }));
    expect(setBounds).toHaveBeenLastCalledWith({ x: 800, y: 460, width: 400, height: 240 });

    // A dialog comes up: it covers the page, so the page goes away entirely.
    rerender(<WithOverlay open={true} />);
    expect(setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 });

    act(() => setLocalMenuCover(null));
  });
});

// The whole way round: the pane with its real zoom menu, and the button the user clicked. Opening
// the menu must not take the page away — the page steps aside around the menu and stays on screen.
describe("BrowserPane with its zoom menu", () => {
  const setBounds = vi.fn();
  beforeEach(() => {
    setBounds.mockClear();
    (window as unknown as { weft: unknown }).weft = { browser: { setBounds, zoom: vi.fn() } };
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    // The page's placeholder fills the pane; the zoom menu hangs off the toolbar on its right.
    // jsdom has no layout, so each is given a size.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.className.includes("w-56")) {
        return { left: 976, top: 140, width: 224, height: 320 } as DOMRect;
      }
      return { left: 800, top: 100, width: 400, height: 600 } as DOMRect;
    });
  });
  afterEach(() => {
    act(() => setLocalMenuCover(null));
    delete (window as unknown as { weft?: unknown }).weft;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const pane = () => (
    <BrowserPane desktop state={{ url: "https://example.com" } as never} obscured={false} expanded={false} width={400} onWidth={() => {}} onClose={() => {}} />
  );

  it("keeps the page on screen when the zoom menu opens", () => {
    render(pane());
    fireEvent.click(screen.getByLabelText("Page zoom"));

    // The page is still there: it keeps the strip below the menu rather than vanishing.
    const box = setBounds.mock.calls.at(-1)?.[0] as { width: number; height: number };
    expect(box).not.toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});
