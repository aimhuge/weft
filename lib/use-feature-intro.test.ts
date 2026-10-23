// @vitest-environment happy-dom
import { act, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntroFrame } from "@/components/FeatureIntro";
import { INTROS_KEY, markIntroSeen, REPLAY_MESSAGE, type IntroId } from "./feature-intros";
import { useFeatureIntro } from "./use-feature-intro";

const play = vi.fn();
const stop = vi.fn();
const setMuted = vi.fn();

vi.mock("./welcome-voice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./welcome-voice")>();
  return {
    ...actual,
    VoicePlayer: class {
      play = play;
      stop = stop;
      setMuted = setMuted;
    },
  };
});

// A message from the intro's own iframe, as public/intros/player.js posts it.
function fromFrame(source: unknown, data: unknown) {
  window.dispatchEvent(Object.assign(new Event("message"), { source, data }));
}

// IntroFrame owns the iframe, so read it back out of the document to hear it.
const frameOf = () => document.querySelector("iframe")!.contentWindow;

describe("useFeatureIntro", () => {
  beforeEach(() => {
    localStorage.clear();
    play.mockClear();
    stop.mockClear();
    setMuted.mockClear();
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

  it("plays the voice when the page says it started, and counts as seen when it ends", () => {
    // IntroFrame owns the iframe; read it back out of the document to hear it.
    const { result } = renderHook(() => useFeatureIntro("vault"));
    const { container } = render(createElement(IntroFrame, { intro: result.current }));
    const frame = container.querySelector("iframe")!;

    fromFrame(frame.contentWindow, { weft: "intro", event: "start" });
    expect(play).toHaveBeenCalledWith("/intros/vault.m4a");
    expect(result.current.ended).toBe(false);

    act(() => fromFrame(frame.contentWindow, { weft: "intro", event: "done" }));
    expect(result.current.ended).toBe(true);
    expect(JSON.parse(localStorage.getItem(INTROS_KEY) ?? "[]")).toContain("vault");
  });

  it("ignores a message from any other frame", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    render(createElement(IntroFrame, { intro: result.current }));
    fromFrame({}, { weft: "intro", event: "start" });
    fromFrame(null, { weft: "intro", event: "done" });
    expect(play).not.toHaveBeenCalled();
    expect(result.current.ended).toBe(false);
  });

  it("ignores its own frame's events it doesn't know", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    render(createElement(IntroFrame, { intro: result.current }));
    act(() => fromFrame(frameOf(), { weft: "intro", event: "paused" }));
    expect(play).not.toHaveBeenCalled();
    expect(result.current.ended).toBe(false);
  });

  it("hides cleanly with no intro open", () => {
    const { result } = renderHook(() => useFeatureIntro(null));
    act(() => result.current.hide());
    expect(result.current.open).toBe(false);
  });

  it("counts it seen when you hide it, and stops the voice", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    act(() => result.current.hide());
    expect(result.current.open).toBe(false);
    expect(stop).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(INTROS_KEY) ?? "[]")).toContain("vault");
  });

  it("stops the voice when the drawer closes", () => {
    const { rerender } = renderHook(({ id }: { id: IntroId | null }) => useFeatureIntro(id), { initialProps: { id: "vault" as IntroId | null } });
    rerender({ id: null });
    expect(stop).toHaveBeenCalled();
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

  it("carries the welcome tour's mute, and remembers it", () => {
    const { result } = renderHook(() => useFeatureIntro("vault"));
    act(() => result.current.toggleMuted());
    expect(result.current.muted).toBe(true);
    expect(setMuted).toHaveBeenLastCalledWith(true);
    expect(renderHook(() => useFeatureIntro("vercel")).result.current.muted).toBe(true);
    act(() => result.current.toggleMuted());
    expect(renderHook(() => useFeatureIntro("vercel")).result.current.muted).toBe(false);
  });
});