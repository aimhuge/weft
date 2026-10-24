// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameState } from "@/lib/game-server";
import type { ProjectReport } from "@/lib/project-badges";
import GameBadge from "./GameBadge";
import "./test-utils";

const project: ProjectReport = { root: "/dev/app", name: "app", stack: ["Next.js"], ok: { readme: true }, score: 70, coverage: 50, perfect: false, clean: true };

function game(over: Partial<GameState> = {}): GameState {
  return {
    name: "Ada",
    xp: 120,
    level: { level: 2, title: "Thread", floor: 40, next: 160 },
    weekXp: 30,
    weekShipped: 1,
    totals: { started: 0, shipped: 0 },
    streak: { current: 4, best: 9, freezes: 1, frozen: [], atRisk: false, reached: {} },
    today: { cards: 2, turns: 3, done: 1, xp: 17 },
    cloth: [{ day: "2026-10-11", xp: 17, tone: 4 }],
    usage: [
      { day: "2026-10-10", input: 0, output: 0, fiveHour: 0, sevenDay: 0 },
      { day: "2026-10-11", input: 1_200_000, output: 300_000, fiveHour: 1, sevenDay: 1 },
    ],
    limitHits: { fiveHour: 3, sevenDay: 1 },
    records: { biggestDay: { day: "2026-10-09", cards: 9 }, mostShipped: null, maxRunning: 2, fastest: 5 * 60_000, cheapest: null },
    attributes: [{ id: "follow", icon: "🎯", label: "Follow-through", value: 80, hint: "8 of 10" }],
    className: "Finisher",
    skills: [{ tech: "Next.js", xp: 100, level: 3 }],
    badges: [
      { id: "first-card", icon: "🧵", name: "First thread", desc: "Start a card", group: "Milestones", unlocked: true, at: 1 },
      { id: "guarded", icon: "🛡️", name: "Guarded", desc: "Hooks and CI", group: "Code health", unlocked: false, fix: { check: "guarded" } },
    ],
    projects: [project],
    inView: "/dev/app",
    leagues: ["Cotton", "Linen"],
    ...over,
  };
}

let state = game();
let league: unknown = { state: "signed-out" };
beforeEach(() => {
  state = game();
  localStorage.clear();
  document.cookie = "weft-show-progress=; path=/; max-age=0";
  league = { state: "signed-out" };
  // The You tab asks /api/apps for My mini apps and /api/league for the league; everything else is the game.
  const body = (url: string) => (url.startsWith("/api/apps") ? { apps: [] } : url.startsWith("/api/league") ? { league } : { game: state });
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(body(url))))));
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const onStart = vi.fn();
  const view = render(<GameBadge cwd="/dev/app" refresh={1} onStart={onStart} />);
  return { onStart, view };
}

describe("GameBadge", () => {
  it("shows the streak and level, and stays quiet the first time", async () => {
    setup();
    expect(await screen.findByRole("button", { name: "Wefter Profile: 4-day streak, level 2" })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem("weft-game-announced") ?? "{}")).toEqual({ badges: ["first-card"], level: 2 }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("pops a badge earned since last time, and See your profile opens it on Badges", async () => {
    localStorage.setItem("weft-game-announced", JSON.stringify({ badges: [], level: 2 }));
    setup();
    const popup = await screen.findByRole("dialog", { name: "Achievement unlocked!" });
    expect(popup).toHaveTextContent("First thread");
    expect(popup).toHaveTextContent("Start a card");
    await userEvent.click(screen.getByRole("button", { name: "See your profile" }));
    expect(screen.queryByRole("dialog", { name: "Achievement unlocked!" })).not.toBeInTheDocument();
    expect(await screen.findByText("Guarded")).toBeInTheDocument();
  });

  it("lists several badges earned at once", async () => {
    localStorage.setItem("weft-game-announced", JSON.stringify({ badges: [], level: 2 }));
    const extra = { id: "streak-7", icon: "🔥", name: "Week of work", desc: "7 days in a row", group: "Streaks" as const, unlocked: true, at: 2 };
    state = game({ badges: [...game().badges, extra] });
    setup();
    const popup = await screen.findByRole("dialog", { name: "2 achievements unlocked!" });
    expect(popup).toHaveTextContent("First thread");
    expect(popup).toHaveTextContent("Week of work");
  });

  it("pops a level-up, and Nice! closes it", async () => {
    localStorage.setItem("weft-game-announced", JSON.stringify({ badges: ["first-card"], level: 1 }));
    setup();
    const popup = await screen.findByRole("dialog", { name: "Level up!" });
    expect(popup).toHaveTextContent("Level 2 · Thread");
    expect(popup).toHaveTextContent("Episode II");
    expect(popup.querySelector("img")?.getAttribute("src")).toBe("/brand/levels/thread.webp");
    await userEvent.click(screen.getByRole("button", { name: "Nice!" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("replays the last popup on the replay event, and the current level before any", async () => {
    setup();
    await screen.findByRole("button", { name: /Wefter Profile/ });
    window.dispatchEvent(new Event("weft:achievement-replay"));
    expect(await screen.findByRole("dialog", { name: "Level up!" })).toHaveTextContent("Level 2 · Thread");
    await userEvent.click(screen.getByRole("button", { name: "Nice!" }));

    localStorage.setItem("weft-game-last-achievement", JSON.stringify({ fresh: [game().badges[0]], level: null }));
    window.dispatchEvent(new Event("weft:achievement-replay"));
    expect(await screen.findByRole("dialog", { name: "Achievement unlocked!" })).toHaveTextContent("First thread");
  });

  it("keeps a popup it opens for the replay", async () => {
    localStorage.setItem("weft-game-announced", JSON.stringify({ badges: ["first-card"], level: 1 }));
    setup();
    await screen.findByRole("dialog", { name: "Level up!" });
    expect(JSON.parse(localStorage.getItem("weft-game-last-achievement") ?? "{}")).toMatchObject({ fresh: [], level: { level: 2 } });
  });

  it("hides in quiet mode", async () => {
    document.cookie = "weft-show-progress=0; path=/";
    setup();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: /Wefter Profile/ })).toBeNull();
  });

  it("opens the loom, walks its tabs and starts a card from Set it up", async () => {
    const { onStart } = setup();
    await userEvent.click(await screen.findByRole("button", { name: /Wefter Profile/ }));
    expect(await screen.findByText("Finisher")).toBeInTheDocument();
    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Tokens per day/ })).toBeInTheDocument();
    expect(screen.getByText("(3 all time)")).toBeInTheDocument();
    await userEvent.hover(screen.getByRole("img", { name: /Tokens per day/ }).querySelectorAll("g")[1] as Element);
    expect(screen.getByText(/2026-10-11: 1\.5M tokens \(1\.2M in · 300K out\) · ⏳ 1 5-hour hit · 🗓️ 1 weekly hit/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Badges/ }));
    expect(screen.getByText("First thread")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set it up" }));
    expect(onStart).toHaveBeenCalledWith("/dev/app", expect.stringContaining("pre-commit hook"), "Guarded for app");
  });

  it("shows each project's tree and an All leagues button", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /Wefter Profile/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Projects" }));
    expect(screen.getByText("README")).toBeInTheDocument();
    expect(screen.getByText(/50% lines covered/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "League" }));
    expect(await screen.findByText(/Sign in to Weft/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All leagues/ })).toBeInTheDocument();
    expect(screen.getByText("This week: 30 XP")).toBeInTheDocument();
  });

  it("shows your league with each builder's week and opens their profile", async () => {
    const open = vi.fn();
    (window as unknown as { weft: unknown }).weft = { openExternal: open };
    league = {
      state: "ready", week: "2026-10-12", tier: 0, league: "Cotton", up: 1, down: 0,
      rows: [
        { rank: 1, userId: "u1", name: "Alex", avatar: "https://a/1.png", username: "fotoflo", xp: 6588, shipped: 36, streak: 31, level: 20, badges: [{ icon: "🔥", name: "Month streak" }], isMe: true },
        { rank: 2, userId: "u2", name: "Adnan Sabbir", avatar: null, username: null, xp: 0, shipped: 0, streak: 0, level: 1, badges: [], isMe: false },
      ],
    };
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /Wefter Profile/ }));
    await userEvent.click(screen.getByRole("button", { name: "League" }));
    expect(await screen.findByText("Cotton League")).toBeInTheDocument();
    expect(screen.getByText("6,588")).toBeInTheDocument();
    expect(screen.getByText("top 1 move up")).toBeInTheDocument();
    expect(screen.getByText("Adnan Sabbir")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Alex/ }));
    expect(open).toHaveBeenCalledWith("https://weft.zip/@fotoflo");
    delete (window as unknown as { weft?: unknown }).weft;
  });
});
