// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStepVoice } from "./use-welcome-tour";
import { MUTE_KEY } from "./welcome-loop";

// The welcome's later steps speak as they open (lib/use-welcome-tour.ts), unless the tour was muted.
// (useWelcomeTour itself is covered through components/WelcomeLoop.test.tsx.)

const played = vi.hoisted(() => [] as string[]);

beforeEach(() => {
  played.length = 0;
  localStorage.clear();
  vi.stubGlobal(
    "Audio",
    vi.fn(function (this: Record<string, unknown>, src: string) {
      Object.assign(this, { src, muted: false, play: () => Promise.resolve(), pause: vi.fn() });
      played.push(src);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useStepVoice", () => {
  it("says each later step's line as it opens, and nothing on the first", () => {
    const { rerender } = renderHook(({ step }) => useStepVoice(step), { initialProps: { step: "ready" } });
    expect(played).toEqual([]);
    rerender({ step: "projects" });
    rerender({ step: "first" });
    expect(played).toEqual(["/welcome/narration-projects.m4a", "/welcome/narration-first.m4a"]);
  });

  it("stays quiet when the tour was muted", () => {
    localStorage.setItem(MUTE_KEY, "1");
    renderHook(() => useStepVoice("projects"));
    expect(played).toEqual([]);
  });
});
