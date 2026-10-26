// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { markIntroSeen } from "./feature-intros";
import { hasPane, paneIntroUrl, playPaneIntro } from "./pane-intro";

const intro = `${window.location.origin}/intros/newthread.html?live=1`;

describe("playPaneIntro", () => {
  afterEach(() => {
    delete (window as { weft?: unknown }).weft;
  });

  it("plays it again in the pane it is given, seen or not", () => {
    markIntroSeen("newthread");
    const open = vi.fn().mockResolvedValue(undefined);
    (window as { weft?: unknown }).weft = { browser: { open } };
    playPaneIntro("newthread", "new-thread");
    expect(open).toHaveBeenCalledWith(intro, "new-thread");
  });

  it("does nothing without a pane, and shrugs off a failed open", () => {
    expect(() => playPaneIntro("newthread", "new-thread")).not.toThrow();
    (window as { weft?: unknown }).weft = { browser: { open: vi.fn().mockRejectedValue(new Error("gone")) } };
    expect(() => playPaneIntro("newthread", "new-thread")).not.toThrow();
  });
});

describe("hasPane and paneIntroUrl", () => {
  afterEach(() => {
    delete (window as { weft?: unknown }).weft;
  });

  it("finds the desktop's pane bridge, and nothing on the web", () => {
    expect(hasPane()).toBe(false);
    (window as { weft?: unknown }).weft = { browser: { open: () => Promise.resolve() } };
    expect(hasPane()).toBe(true);
  });

  it("puts the intro on Weft's own origin", () => {
    expect(paneIntroUrl("newthread", "http://localhost:3000")).toBe("http://localhost:3000/intros/newthread.html?live=1");
  });
});
