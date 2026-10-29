// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Badge } from "@/lib/game-badges";
import AchievementPopup from "./AchievementPopup";
import "./test-utils";

const badge = (id: string, name: string): Badge => ({ id, icon: "🛡️", name, desc: `${name} desc`, group: "Milestones", unlocked: true });
const level = { level: 24, title: "Loom", floor: 21160, next: 23000 };
const play = vi.fn(function (this: HTMLMediaElement) {
  return Promise.resolve();
});
const pause = vi.fn();

beforeEach(() => {
  localStorage.clear();
  play.mockClear();
  pause.mockClear();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
});

function setup(achievement: Parameters<typeof AchievementPopup>[0]["achievement"]) {
  const onProfile = vi.fn();
  const onClose = vi.fn();
  render(<AchievementPopup achievement={achievement} onProfile={onProfile} onClose={onClose} />);
  return { onProfile, onClose };
}

describe("AchievementPopup", () => {
  it("opens a level-up on its rank's picture with the episode and a line of story", () => {
    setup({ fresh: [], level });
    const popup = screen.getByRole("dialog", { name: "Level up!" });
    expect(popup.querySelector("img")?.getAttribute("src")).toBe("/brand/levels/loom.webp");
    expect(popup).toHaveTextContent("Episode XXIV");
    expect(popup).toHaveTextContent("Level 24 · Loom");
    expect(popup).not.toHaveTextContent("⬆️");
  });

  it("leaves the words on the dark backdrop when the picture fails to load", () => {
    setup({ fresh: [], level });
    const img = screen.getByRole("dialog").querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    expect(screen.getByRole("dialog").querySelector("img")).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent("Episode XXIV");
  });

  it("gives one badge the stage, with no picture", () => {
    setup({ fresh: [badge("a", "Guarded")], level: null });
    const popup = screen.getByRole("dialog", { name: "Achievement unlocked!" });
    expect(popup).toHaveTextContent("Guarded");
    expect(popup).toHaveTextContent("Guarded desc");
    expect(popup.querySelector("img")).toBeNull();
  });

  it("lists several badges, five and then how many more", () => {
    const fresh = Array.from({ length: 7 }, (_, i) => badge(`b${i}`, `Badge ${i}`));
    setup({ fresh, level: null });
    const popup = screen.getByRole("dialog", { name: "7 achievements unlocked!" });
    expect(popup).toHaveTextContent("Badge 4");
    expect(popup).not.toHaveTextContent("Badge 5");
    expect(popup).toHaveTextContent("and 2 more");
  });

  it("shows the level under a badge when both arrive together, with the picture on top", () => {
    setup({ fresh: [badge("a", "Guarded")], level });
    const popup = screen.getByRole("dialog", { name: "Achievement unlocked!" });
    expect(popup.querySelector("img")).not.toBeNull();
    expect(popup).toHaveTextContent("Level 24 · Loom");
  });

  it("reads the line aloud as a level-up opens, and stops when it closes", () => {
    const { unmount } = render(<AchievementPopup achievement={{ fresh: [], level }} onProfile={vi.fn()} onClose={vi.fn()} />);
    return Promise.resolve().then(() => {
      expect(play).toHaveBeenCalledOnce();
      expect((play.mock.contexts[0] as HTMLAudioElement).src).toContain("/brand/levels/voice/loom-5.m4a");
      unmount();
      expect(pause).toHaveBeenCalled();
    });
  });

  it("stays quiet when Weft's voice is muted, and the 🔊 mutes it for next time", async () => {
    setup({ fresh: [], level });
    await userEvent.click(screen.getByRole("button", { name: "Mute the voice" }));
    expect(localStorage.getItem("weft-welcome-muted")).toBe("1");
    cleanup();
    play.mockClear();
    setup({ fresh: [], level });
    await Promise.resolve();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Unmute the voice" })).toBeInTheDocument();
  });

  it("opens the profile and closes", async () => {
    const { onProfile, onClose } = setup({ fresh: [], level });
    await userEvent.click(screen.getByRole("button", { name: "See your profile" }));
    expect(onProfile).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Nice!" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // GitHub issue #14: the buttons were below the fold with no scroll container, so a short window
  // couldn't dismiss the pop-up at all. The panel is capped, the badges scroll, the buttons stay.
  it("caps the panel's height so it can never outgrow the window", () => {
    setup({ fresh: [], level });
    expect(screen.getByRole("dialog")).toHaveClass("max-h-[92vh]");
  });

  it("keeps the buttons out of the scrolling region, pinned in a footer", () => {
    const fresh = Array.from({ length: 7 }, (_, i) => badge(`b${i}`, `Badge ${i}`));
    setup({ fresh, level });
    const nice = screen.getByRole("button", { name: "Nice!" });
    const scroller = screen.getByRole("dialog").querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    // The badges scroll above; the buttons sit outside that region, so they stay put.
    expect(scroller).toHaveTextContent("Badge 4");
    expect(scroller).not.toContainElement(nice);
    expect(nice.closest(".shrink-0")).not.toBeNull();
  });
});
