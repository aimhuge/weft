// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import { WelcomeLoop } from "./WelcomeLoop";

// The Get ready hero (components/WelcomeLoop.tsx): the live tour with your project names, the still screenshot when the
// system asks for reduced motion, and the Sign in with GitHub button over the profile beat.

const account = vi.hoisted(() => ({
  value: {
    state: { kind: "ready", view: { configured: true, user: null as null | { name: string; avatar: string | null } } },
    busy: null as string | null,
    waiting: null,
    signIn: vi.fn(),
  },
}));
vi.mock("@/lib/use-account", () => ({ useAccount: () => account.value }));

function motion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

// A beat message from the tour's page, as its live.js posts it.
function post(frame: HTMLIFrameElement, beat: string, extra: { t?: number; jumped?: boolean } = {}) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { weft: "welcome", beat, ...extra }, source: frame.contentWindow }));
  });
}

// Every narration track the component starts.
const played = vi.hoisted(() => [] as { src: string; muted: boolean; pause: () => void }[]);

beforeEach(() => {
  played.length = 0;
  vi.stubGlobal(
    "Audio",
    vi.fn(function (this: Record<string, unknown>, src: string) {
      Object.assign(this, { src, muted: false, play: () => Promise.resolve(), pause: vi.fn() });
      played.push(this as unknown as (typeof played)[number]);
    }),
  );
  account.value.state.view.user = null;
  account.value.signIn.mockReset();
  motion(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("WelcomeLoop", () => {
  it("plays the tour with your project names, sandboxed and out of the tab order", () => {
    render(<WelcomeLoop projects={["weft", "deckcp"]} />);
    const frame = screen.getByTitle(/How Weft works/);
    expect(frame.getAttribute("src")).toBe("/welcome/intro.html?live=1&tour=1&p=weft%2Cdeckcp");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("tabindex")).toBe("-1");
  });

  it("shows the still board instead when reduced motion is on", () => {
    motion(true);
    render(<WelcomeLoop projects={[]} />);
    expect(screen.queryByTitle(/How Weft works/)).toBeNull();
    expect(screen.getByAltText(/A Weft board/)).toHaveAttribute("src", "/brand/faq/tour-board.jpg");
  });

  it("offers Sign in with GitHub only while the profile beat is on screen", () => {
    render(<WelcomeLoop projects={[]} />);
    const frame = screen.getByTitle<HTMLIFrameElement>(/How Weft works/);
    expect(screen.queryByRole("button", { name: /Sign in with GitHub/ })).toBeNull();
    post(frame, "profile");
    fireEvent.click(screen.getByRole("button", { name: /Sign in with GitHub/ }));
    expect(account.value.signIn).toHaveBeenCalledWith("github");
    post(frame, "quality");
    expect(screen.queryByRole("button", { name: /Sign in with GitHub/ })).toBeNull();
  });

  it("sends your name to the profile beat once you're signed in, and offers no sign-in", () => {
    account.value.state.view.user = { name: "Ada", avatar: "https://avatars.example/ada.png" };
    render(<WelcomeLoop projects={[]} />);
    const frame = screen.getByTitle<HTMLIFrameElement>(/How Weft works/);
    const sent = vi.spyOn(frame.contentWindow as Window, "postMessage");
    post(frame, "tools");
    expect(sent).toHaveBeenCalledWith({ weft: "who", name: "Ada", avatar: "https://avatars.example/ada.png" }, "*");
    post(frame, "profile");
    expect(screen.queryByRole("button", { name: /Sign in with GitHub/ })).toBeNull();
  });

  it("narrates each page as it starts, and the mute button quiets it", () => {
    render(<WelcomeLoop projects={[]} />);
    const frame = screen.getByTitle<HTMLIFrameElement>(/How Weft works/);
    post(frame, "loop");
    expect(played.map((a) => a.src)).toEqual(["/welcome/narration-loop.m4a"]);
    post(frame, "tools");
    post(frame, "profile");
    expect(played.map((a) => a.src)).toEqual(["/welcome/narration-loop.m4a", "/welcome/narration-beats.m4a"]);
    fireEvent.click(screen.getByRole("button", { name: "Mute narration" }));
    expect(played.at(-1)?.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Turn narration on" })).toBeInTheDocument();
  });

  it("frames each beat with its title, and Back and Next step one beat at a time", () => {
    render(<WelcomeLoop projects={[]} />);
    const frame = screen.getByTitle<HTMLIFrameElement>(/How Weft works/);
    const sent = vi.spyOn(frame.contentWindow as Window, "postMessage");
    expect(screen.getByText("Welcome to Weft")).toBeInTheDocument();
    expect(screen.getByText("1 of 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back a beat" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next beat" }));
    expect(sent).toHaveBeenLastCalledWith({ weft: "go", beat: "loop", page: "loop.html" }, "*");
    // The bar moves at once, so a quick second click steps on before the page has answered.
    expect(screen.getByText("2 of 10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next beat" }));
    expect(sent).toHaveBeenLastCalledWith({ weft: "go", beat: "tools", page: "beats.html" }, "*");

    post(frame, "tools");
    expect(screen.getByText("3 of 10")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back a beat" }));
    expect(sent).toHaveBeenLastCalledWith({ weft: "go", beat: "loop", page: "loop.html" }, "*");
    fireEvent.click(screen.getByRole("button", { name: "Your Wefter Profile" }));
    expect(sent).toHaveBeenLastCalledWith({ weft: "go", beat: "profile", page: "beats.html" }, "*");

    post(frame, "keys");
    expect(screen.getByRole("button", { name: "Next beat" })).toBeDisabled();
  });

  it("picks the voiceover up where a jump lands", () => {
    render(<WelcomeLoop projects={[]} />);
    const frame = screen.getByTitle<HTMLIFrameElement>(/How Weft works/);
    post(frame, "blastcp", { t: 24, jumped: true });
    expect(played.map((a) => [a.src, (a as unknown as { currentTime?: number }).currentTime])).toEqual([["/welcome/narration-beats.m4a", 24]]);
  });
});
