import { describe, expect, it } from "vitest";
import { clearOfCopilot, copilotCover, copilotPanel, LAUNCHER, launcherBox, overlaps, PANEL, PANEL_BOTTOM, panelBox, setCopilotLauncher, setCopilotPanel } from "./copilot-float";

describe("panelBox", () => {
  it("pins the panel above the launcher in the bottom-right corner", () => {
    expect(PANEL_BOTTOM).toBe(LAUNCHER.bottom + LAUNCHER.size + 12);
    expect(panelBox({ width: 1280, height: 900 }, PANEL.open)).toEqual({ x: 1280 - 16 - 400, y: 900 - 108 - 640, width: 400, height: 640 });
  });

  it("shrinks to a small window and never goes negative", () => {
    expect(panelBox({ width: 300, height: 500 }, PANEL.open)).toEqual({ x: 16, y: 16, width: 268, height: 376 });
    expect(panelBox({ width: 10, height: 10 }, PANEL.peek)).toMatchObject({ width: 0, height: 0 });
  });
});

describe("overlaps", () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  it("is true only when the boxes share area", () => {
    expect(overlaps(a, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
    expect(overlaps(a, { x: 100, y: 0, width: 50, height: 50 })).toBe(false);
    expect(overlaps(a, { x: 0, y: 100, width: 50, height: 50 })).toBe(false);
  });

  it("is false without both boxes", () => {
    expect(overlaps(a, null)).toBe(false);
    expect(overlaps(null, a)).toBe(false);
  });
});

describe("the open panel's box", () => {
  it("changes only when the box does", () => {
    setCopilotPanel(null);
    const box = { x: 1, y: 2, width: 3, height: 4 };
    setCopilotPanel(box);
    expect(copilotPanel()).toBe(box);
    // An equal box keeps the first, so the pane doesn't re-measure for nothing.
    setCopilotPanel({ ...box });
    expect(copilotPanel()).toBe(box);
    setCopilotPanel(null);
    expect(copilotPanel()).toBeNull();
  });

  it("keeps the launcher's box beside the panel's", () => {
    const box = { x: 1, y: 2, width: 52, height: 52 };
    setCopilotLauncher(box);
    expect(copilotCover()).toEqual({ launcher: box, panel: null });
    setCopilotLauncher(null);
    expect(copilotCover()).toEqual({ launcher: null, panel: null });
  });
});

describe("launcherBox", () => {
  it("sits in the bottom-right corner, clear of the footer", () => {
    expect(launcherBox({ width: 1280, height: 800 })).toEqual({ x: 1280 - 16 - 52, y: 800 - LAUNCHER.bottom - 52, width: 52, height: 52 });
  });
});

describe("clearOfCopilot", () => {
  const pane = { x: 800, y: 100, width: 464, height: 680 };
  const launcher = launcherBox({ width: 1280, height: 800 });

  it("leaves the pane alone when the copilot is elsewhere or gone", () => {
    expect(clearOfCopilot(pane, { launcher: null, panel: null })).toBe(pane);
    expect(clearOfCopilot({ ...pane, x: 100, width: 300 }, { launcher, panel: null })).toEqual({ ...pane, x: 100, width: 300 });
  });

  it("stops the pane short above the launcher in its corner", () => {
    expect(clearOfCopilot(pane, { launcher, panel: null })).toEqual({ ...pane, height: launcher.y - 8 - pane.y });
  });

  it("hides the pane under the peek or the chat, or when nothing is left above the launcher", () => {
    expect(clearOfCopilot(pane, { launcher, panel: panelBox({ width: 1280, height: 800 }, PANEL.peek) })).toBeNull();
    expect(clearOfCopilot({ ...pane, y: launcher.y - 4, height: 40 }, { launcher, panel: null })).toBeNull();
  });
});
