// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSplash, seenVersion } from "@/lib/release-splash";
import { resetDecidedForTests, useReleaseSplash } from "@/lib/use-release-splash";
import ReleaseSplash, { SplashBody } from "./ReleaseSplash";

vi.mock("@/lib/release-splashes.json", () => ({
  default: {
    "0.7.0": { lines: ["Your board reads like a sheet", "Agents pick the voice"] },
    "0.8.0": { lines: ["With a video"], video: "/whats-new/0.8.0.mp4" },
  },
}));

const welcome = vi.hoisted(() => ({ loadWelcome: vi.fn() }));
vi.mock("@/lib/welcome-client", () => welcome);

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  resetDecidedForTests();
  resetSplash();
  process.env.NEXT_PUBLIC_APP_VERSION = "0.7.0";
  welcome.loadWelcome.mockResolvedValue({ welcome: { at: 1 } });
});

describe("ReleaseSplash", () => {
  it("shows the version's lines once after an update, and Nice closes it", async () => {
    localStorage.setItem("weft-splash-version", "0.6.2");
    render(<ReleaseSplash />);
    expect(await screen.findByText("What's new in Weft 0.7.0")).toBeTruthy();
    expect(screen.getByText("Your board reads like a sheet")).toBeTruthy();
    expect(screen.getByText("Full release notes").getAttribute("href")).toBe("https://github.com/aimhuge/weft/releases/tag/v0.7.0");
    expect(seenVersion()).toBe("0.7.0");
    await userEvent.click(screen.getByRole("button", { name: "Nice" }));
    expect(screen.queryByText("What's new in Weft 0.7.0")).toBeNull();
  });

  it("decides once a launch, and a remount shows the same splash", async () => {
    const { unmount } = render(<ReleaseSplash />);
    await screen.findByText("What's new in Weft 0.7.0");
    unmount();
    render(<ReleaseSplash />);
    expect(await screen.findByText("What's new in Weft 0.7.0")).toBeTruthy();
    expect(welcome.loadWelcome).toHaveBeenCalledTimes(1);
  });

  it("stays closed for the rest of the launch once closed", async () => {
    const { unmount } = render(<ReleaseSplash />);
    await userEvent.click(await screen.findByRole("button", { name: "Nice" }));
    unmount();
    render(<ReleaseSplash />);
    await Promise.resolve();
    expect(screen.queryByText(/What's new/)).toBeNull();
  });

  it("stays quiet on a fresh install, recording the version", async () => {
    welcome.loadWelcome.mockResolvedValue({ welcome: null });
    render(<ReleaseSplash />);
    await waitFor(() => expect(seenVersion()).toBe("0.7.0"));
    expect(screen.queryByText(/What's new/)).toBeNull();
  });

  it("decides again next time when the welcome can't be read", async () => {
    welcome.loadWelcome.mockRejectedValueOnce(new Error("down"));
    const first = render(<ReleaseSplash />);
    await waitFor(() => expect(welcome.loadWelcome).toHaveBeenCalledTimes(1));
    first.unmount();
    render(<ReleaseSplash />);
    expect(await screen.findByText("What's new in Weft 0.7.0")).toBeTruthy();
  });

  it("does nothing without a version", () => {
    function Probe() {
      const { open } = useReleaseSplash("");
      return <p>{open ? "open" : "closed"}</p>;
    }
    render(<Probe />);
    expect(screen.getByText("closed")).toBeTruthy();
    expect(welcome.loadWelcome).not.toHaveBeenCalled();
  });

  // React's dev double mount: the first mount goes away before the welcome answers, and the second still shows it.
  it("opens on the mount that's left when one unmounts before the welcome answers", async () => {
    let answer: (v: unknown) => void = () => {};
    welcome.loadWelcome.mockReturnValue(new Promise((r) => (answer = r)));
    const first = render(<ReleaseSplash />);
    first.unmount();
    render(<ReleaseSplash />);
    answer({ welcome: { at: 1 } });
    expect(await screen.findByText("What's new in Weft 0.7.0")).toBeTruthy();
    expect(welcome.loadWelcome).toHaveBeenCalledTimes(1);
  });

  it("doesn't open on a mount that's gone when the welcome answers", async () => {
    let answer: (v: unknown) => void = () => {};
    welcome.loadWelcome.mockReturnValue(new Promise((r) => (answer = r)));
    const { unmount } = render(<ReleaseSplash />);
    unmount();
    answer({ welcome: { at: 1 } });
    await waitFor(() => expect(seenVersion()).toBe("0.7.0"));
    expect(screen.queryByText(/What's new/)).toBeNull();
  });
});

describe("SplashBody", () => {
  it("plays a release's video muted, with controls", () => {
    const { container } = render(<SplashBody version="0.8.0" splash={{ lines: ["With a video"], video: "/whats-new/0.8.0.mp4" }} onClose={() => {}} />);
    const video = container.ownerDocument.querySelector("video");
    expect(video?.getAttribute("src")).toBe("/whats-new/0.8.0.mp4");
    expect(video?.muted).toBe(true);
    expect(video?.hasAttribute("controls")).toBe(true);
  });
});
