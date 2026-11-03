// electron/pane-view.cjs: how a pane tab's view is made and laid out, over a fake WebContentsView.
import { describe, expect, it, vi } from "vitest";
import { PANE_PARTITION, paneWebPreferences, placeView } from "./pane-view.cjs";

function fakeView({ focused = false } = {}) {
  const webContents = {
    isFocused: () => focused,
    setAudioMuted: vi.fn(),
    setBackgroundThrottling: vi.fn(),
  };
  return { setBounds: vi.fn(), setVisible: vi.fn(), webContents };
}

const bounds = { x: 0, y: 0, width: 400, height: 600 };

describe("paneWebPreferences", () => {
  it("starts a tab unthrottled, in the pane's own sandboxed session", () => {
    const prefs = paneWebPreferences();
    expect(prefs).toMatchObject({ partition: PANE_PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false });
    expect(prefs.preload).toMatch(/pane-preload\.cjs$/);
  });
});

describe("placeView", () => {
  it("shows, unmutes and keeps painting the page on screen", () => {
    const view = fakeView();
    placeView(view, { bounds, onScreen: true, cardsCurrent: true, focusBoard: vi.fn() });
    expect(view.setBounds).toHaveBeenCalledWith(bounds);
    expect(view.setVisible).toHaveBeenCalledWith(true);
    expect(view.webContents.setAudioMuted).toHaveBeenCalledWith(false);
    expect(view.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
  });

  it("keeps an off-screen card's current tab painting, so a streamed page the agent opened still reveals", () => {
    // The bug: weft.zip/@fotoflo/apps/growth stayed on "Loading the app…" in a card that wasn't open,
    // because the hidden view never ran requestAnimationFrame and React never swapped the boundary in.
    const view = fakeView();
    placeView(view, { bounds, onScreen: false, cardsCurrent: true, focusBoard: vi.fn() });
    expect(view.setVisible).toHaveBeenCalledWith(false);
    expect(view.webContents.setAudioMuted).toHaveBeenCalledWith(true);
    expect(view.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
  });

  it("throttles a background tab", () => {
    const view = fakeView();
    placeView(view, { bounds, onScreen: false, cardsCurrent: false, focusBoard: vi.fn() });
    expect(view.webContents.setBackgroundThrottling).toHaveBeenCalledWith(true);
  });

  it("hands focus back to the board when a focused page goes off screen", () => {
    const focusBoard = vi.fn();
    placeView(fakeView({ focused: true }), { bounds, onScreen: false, cardsCurrent: true, focusBoard });
    expect(focusBoard).toHaveBeenCalledOnce();
  });

  it("leaves focus alone for a page that stays on screen", () => {
    const focusBoard = vi.fn();
    placeView(fakeView({ focused: true }), { bounds, onScreen: true, cardsCurrent: true, focusBoard });
    expect(focusBoard).not.toHaveBeenCalled();
  });
});
