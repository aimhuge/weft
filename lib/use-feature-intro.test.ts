// @vitest-environment happy-dom
import { act, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntroFrame } from "@/components/FeatureIntro";
import { INTROS_KEY, markIntroSeen, muteMessage, REPLAY_MESSAGE } from "./feature-intros";
import { useFeatureIntro } from "./use-feature-intro";

// A message from the intro's own iframe, as public/intros/player.js posts it.
function fromFrame(source: unknown, data: unknown) {
  window.dispatchEvent(Object.assign(new Event("message"), { source, data }));
}

// IntroFrame owns the iframe, so find it in what it rendered. happy-dom gives it no window of its own; stand one in for
// the page, which is what its messages come from.
function standIn(container: HTMLElement) {
  const page = {};
  Object.defineProperty(container.querySelector("iframe")!, "contentWindow", { value: page });
  return page;
}

describe("useFeatureIntro", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("opens itself the first time its drawer does", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    expect(result.current).toMatchObject({ id: "vault", open: true, ended: false });
  });

  it("stays shut once you've seen it, and for no drawer at all", () => {
    markIntroSeen("vault");
    expect(renderHook(() => useFeatureIntro("vault")).result.current.open).toBe(false);
    expect(renderHook(() => useFeatureIntro(null)).result.current.open).toBe(false);
  });

  it("stands down for reduced motion", () => {
    const match = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(renderHook(() => useFeatureIntro("vault")).result.current.open).toBe(false);
    match.mockRestore();
  });

  it("plays anyway when it can't ask about reduced motion", () => {
    const match = vi.spyOn(window, "matchMedia").mockImplementation(() => {
      throw new Error("no matchMedia");
    });
    expect(renderHook(() => useFeatureIntro("vault")).result.current.open).toBe(true);
    match.mockRestore();
  });

  it("loads the page that plays its own voice, and counts as seen when it ends", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    const { container } = render(createElement(IntroFrame, { intro: result.current }));
    expect(container.querySelector("iframe")!.getAttribute("src")).toBe("/intros/vault.html?live=1");
    const page = standIn(container);

    act(() => fromFrame(page, { weft: "intro", event: "done" }));
    act(() => fromFrame(page, { weft: "intro", event: "start" }));
    expect(result.current.ended).toBe(false);

    act(() => fromFrame(page, { weft: "intro", event: "done" }));
    expect(result.current.ended).toBe(true);
    expect(JSON.parse(localStorage.getItem(INTROS_KEY) ?? "[]")).toContain("vault");
  });

  it("ignores a message from any other frame", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    standIn(render(createElement(IntroFrame, { intro: result.current })).container);
    act(() => fromFrame({}, { weft: "intro", event: "done" }));
    act(() => fromFrame(null, { weft: "intro", event: "done" }));
    expect(result.current.ended).toBe(false);
    expect(localStorage.getItem(INTROS_KEY)).toBeNull();
  });

  it("ignores its own frame's events it doesn't know", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    const page = standIn(render(createElement(IntroFrame, { intro: result.current })).container);
    act(() => fromFrame(page, { weft: "intro", event: "paused" }));
    expect(result.current.ended).toBe(false);
    expect(localStorage.getItem(INTROS_KEY)).toBeNull();
  });

  it("hides cleanly with no intro open", () => {
    const { result } = renderHook(() => useFeatureIntro(null));
    act(() => result.current.hide());
    expect(result.current.open).toBe(false);
  });

  it("counts it seen when you hide it, and takes its frame (and voice) away", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    act(() => result.current.hide());
    expect(result.current.open).toBe(false);
    expect(render(createElement(IntroFrame, { intro: result.current })).container.querySelector("iframe")).toBeNull();
    expect(JSON.parse(localStorage.getItem(INTROS_KEY) ?? "[]")).toContain("vault");
  });

  it("asks an open page to start over, and ▶ opens a closed one again", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    const { container } = render(createElement(IntroFrame, { intro: result.current }));
    // happy-dom gives the iframe no contentWindow; the page's address is what it would post to.
    const post = vi.fn();
    Object.defineProperty(container.querySelector("iframe")!, "contentWindow", { value: { postMessage: post } });

    act(() => result.current.play());
    expect(post).toHaveBeenCalledWith(REPLAY_MESSAGE, "*");

    // Closed, ▶ loads a fresh page (a new run remounts the iframe) rather than asking the old one.
    act(() => result.current.hide());
    const run = result.current.run;
    act(() => result.current.play());
    expect(result.current).toMatchObject({ open: true, ended: false, run: run + 1 });
  });

  it("carries the welcome tour's mute to the page, and remembers it", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    const { container } = render(createElement(IntroFrame, { intro: result.current }));
    const post = vi.fn();
    Object.defineProperty(container.querySelector("iframe")!, "contentWindow", { value: { postMessage: post } });
    act(() => result.current.toggleMuted());
    expect(result.current.muted).toBe(true);
    expect(post).toHaveBeenCalledWith(muteMessage(true), "*");
    // The open page heard it; its address doesn't change, so it doesn't reload.
    expect(result.current.src).toBe("/intros/vault.html?live=1");
    // The next one loads muted.
    expect(renderHook(() => useFeatureIntro("vercel")).result.current).toMatchObject({ muted: true, src: "/intros/vercel.html?live=1&muted=1" });
    act(() => result.current.toggleMuted());
    expect(renderHook(() => useFeatureIntro("vercel")).result.current.muted).toBe(false);
  });

  it("has no page to load for no drawer", () => {
    expect(renderHook(() => useFeatureIntro(null)).result.current.src).toBe("");
  });
});