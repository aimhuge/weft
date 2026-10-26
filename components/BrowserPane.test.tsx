// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { setCopilotLauncher, setCopilotPanel } from "@/lib/copilot-float";
import BrowserPane from "./BrowserPane";

vi.mock("@/lib/use-mini-apps", () => ({ useMiniApps: () => [] }));
vi.mock("./AppShareButton", () => ({ default: () => null }));
vi.mock("./SaveAppButton", () => ({ default: () => null }));
vi.mock("./ZoomMenu", () => ({ default: () => null }));

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
