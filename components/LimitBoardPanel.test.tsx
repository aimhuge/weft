// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./test-utils";
import LimitBoardPanel from "./LimitBoardPanel";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ apiFetch }));

const reply = (body: unknown) => apiFetch.mockResolvedValueOnce({ json: () => Promise.resolve(body) });
const row = (rank: number, extra: Record<string, unknown> = {}) => ({
  rank, userId: `u${rank}`, name: `Builder ${rank}`, avatar: null, username: null, value: 25 * 60000, at: Date.UTC(2026, 9, 20), isMe: false, ...extra,
});

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

describe("LimitBoardPanel", () => {
  it("shows the fastest 5-hour board, medals and your row, and switches boards", async () => {
    reply({ board: { state: "ready", board: "five_hour", rows: [row(1, { avatar: "a.png", username: "ann" }), row(2), row(3), row(4, { isMe: true, at: null })] } });
    render(<LimitBoardPanel />);
    expect(await screen.findByText("🥇")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.getAllByText("25m")).toHaveLength(4);
    expect(apiFetch).toHaveBeenCalledWith("/api/league?board=five_hour");

    reply({ board: { state: "ready", board: "five_hour_hits", rows: [row(1, { value: 1200 })] } });
    await userEvent.click(screen.getByText("⏳ Most 5-hour"));
    expect(await screen.findByText("1,200")).toBeTruthy();
    // Coming back reads from what it already has.
    await userEvent.click(screen.getByText("⚡ Fastest 5-hour"));
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });

  it("opens a builder's profile", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    reply({ board: { state: "ready", board: "five_hour", rows: [row(1, { username: "ann" })] } });
    render(<LimitBoardPanel />);
    await userEvent.click(await screen.findByText("Builder 1"));
    expect(open).toHaveBeenCalledWith("https://weft.zip/@ann", "_blank", "noreferrer");
    open.mockRestore();
  });

  it("says when you're signed out, the board is empty, or reading fails", async () => {
    reply({ board: { state: "signed-out" } });
    render(<LimitBoardPanel />);
    expect(await screen.findByText(/Sign in to Weft/)).toBeTruthy();

    reply({ board: { state: "ready", board: "seven_day", rows: [] } });
    await userEvent.click(screen.getByText("☄️ Fastest week"));
    expect(await screen.findByText(/Nobody is on this board yet/)).toBeTruthy();

    reply({ error: "nope" });
    await userEvent.click(screen.getByText("🗓️ Most weekly"));
    expect(await screen.findByText("nope")).toBeTruthy();

    apiFetch.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByText("⏳ Most 5-hour"));
    expect(await screen.findByText("Couldn't reach Weft's server.")).toBeTruthy();
  });

  it("shows a reading state and a server error view", async () => {
    reply({ board: { state: "error", error: "The limit leaderboard isn't on Weft's server yet." } });
    render(<LimitBoardPanel />);
    expect(screen.getByText("Reading the board…")).toBeTruthy();
    expect(await screen.findByText(/isn't on Weft's server yet/)).toBeTruthy();
  });

  it("falls back to a generic error", async () => {
    reply({});
    render(<LimitBoardPanel />);
    expect(await screen.findByText("Couldn't read the board.")).toBeTruthy();
  });
});
