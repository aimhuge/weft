// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardToggles } from "./use-board-toggles";

const setCopilotLaneOpen = vi.fn<(open: boolean) => void>();
const setCopilotLanePeek = vi.fn<(open: boolean) => void>();
vi.mock("./board-prefs", () => ({
  setCopilotLaneOpen: (open: boolean) => setCopilotLaneOpen(open),
  setCopilotLanePeek: (open: boolean) => setCopilotLanePeek(open),
}));

afterEach(cleanup);

function makeToggles(over: Partial<{
  selectedRef: React.RefObject<string | null>;
  browserVisible: boolean;
  setWebBrowserOpen: ReturnType<typeof vi.fn>;
  laneState: "hidden" | "peek" | "open";
  select: ReturnType<typeof vi.fn>;
}> = {}) {
  const selectedRef: React.RefObject<string | null> = over.selectedRef ?? { current: null };
  const setWebBrowserOpen = over.setWebBrowserOpen ?? vi.fn();
  const select = over.select ?? vi.fn();
  const { result } = renderHook(() =>
    useBoardToggles({
      selectedRef,
      browserVisible: over.browserVisible ?? false,
      setWebBrowserOpen: setWebBrowserOpen as unknown as (open: boolean) => void,
      laneState: over.laneState ?? "hidden",
      select: select as unknown as (id: string | null) => void,
    }),
  );
  return { result, setWebBrowserOpen, select, selectedRef };
}

beforeEach(() => {
  setCopilotLaneOpen.mockReset();
  setCopilotLanePeek.mockReset();
  delete (window as { weft?: unknown }).weft;
});

describe("useBoardToggles", () => {
  it("toggleBrowser calls the desktop bridge when present", () => {
    const setVisible = vi.fn();
    (window as { weft?: unknown }).weft = { browser: { setVisible } };
    const { result, setWebBrowserOpen } = makeToggles({ browserVisible: true });
    act(() => result.current.toggleBrowser());
    expect(setVisible).toHaveBeenCalledWith(false);
    expect(setWebBrowserOpen).not.toHaveBeenCalled();
  });

  it("toggleBrowser falls back to setWebBrowserOpen without the bridge", () => {
    const { result, setWebBrowserOpen } = makeToggles({ browserVisible: false });
    act(() => result.current.toggleBrowser());
    expect(setWebBrowserOpen).toHaveBeenCalledWith(true);
  });

  it("toggleBrowser is a no-op when a card is selected", () => {
    const setVisible = vi.fn();
    (window as { weft?: unknown }).weft = { browser: { setVisible } };
    const { result } = makeToggles({ browserVisible: false, selectedRef: { current: "c1" } });
    act(() => result.current.toggleBrowser());
    expect(setVisible).not.toHaveBeenCalled();
  });

  it("toggleCopilot cycles hidden -> peek", () => {
    const { result } = makeToggles({ laneState: "hidden" });
    act(() => result.current.toggleCopilot());
    expect(setCopilotLanePeek).toHaveBeenCalledWith(true);
    expect(setCopilotLaneOpen).toHaveBeenCalledWith(false);
  });

  it("toggleCopilot cycles peek -> open", () => {
    const { result } = makeToggles({ laneState: "peek" });
    act(() => result.current.toggleCopilot());
    expect(setCopilotLaneOpen).toHaveBeenCalledWith(true);
    expect(setCopilotLanePeek).toHaveBeenCalledWith(false);
  });

  it("toggleCopilot cycles open -> hidden", () => {
    const { result } = makeToggles({ laneState: "open" });
    act(() => result.current.toggleCopilot());
    expect(setCopilotLaneOpen).toHaveBeenCalledWith(false);
    expect(setCopilotLanePeek).toHaveBeenCalledWith(false);
  });

  it("setCopilotState closes the copilot card if it is open", () => {
    const { result, select } = makeToggles({ selectedRef: { current: "copilot" } });
    act(() => result.current.setCopilotState("open"));
    expect(select).toHaveBeenCalledWith(null);
    expect(setCopilotLaneOpen).toHaveBeenCalledWith(true);
  });

  it("setCopilotState does not select(null) when no card is open", () => {
    const { result, select } = makeToggles();
    act(() => result.current.setCopilotState("hidden"));
    expect(select).not.toHaveBeenCalled();
    expect(setCopilotLaneOpen).toHaveBeenCalledWith(false);
    expect(setCopilotLanePeek).toHaveBeenCalledWith(false);
  });
});