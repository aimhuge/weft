// @vitest-environment jsdom
// The Users page's activity drawer: it loads one account's activity, draws the stats, calendar and cards-per-day
// bars, and Esc closes it without the page's own Esc (back to the board) firing.

import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/components/test-utils";
import { useEscape } from "@/lib/use-escape";
import type { AdminUserRow } from "@/lib/users-sheet";

const api = vi.hoisted(() => ({ adminGet: vi.fn() }));
vi.mock("../admin-api", () => ({ adminGet: api.adminGet, day: (iso: string | null) => (iso ? iso.slice(0, 10) : "—") }));

const { default: UserActivityDrawer } = await import("./UserActivity");

const USER: AdminUserRow = {
  id: "u1",
  email: "ada@b.co",
  name: "Ada",
  avatarUrl: null,
  provider: "github",
  createdAt: "2026-10-01T00:00:00Z",
  lastSignInAt: "2026-10-16T00:00:00Z",
  lastSeenAt: new Date().toISOString(),
};

const ANSWER = {
  days: [
    { day: "2026-10-23", active: true, cards: 93, items: 1 },
    { day: "2026-10-24", active: false, cards: 0, items: 0 },
    { day: "2026-10-25", active: true, cards: 0, items: 0 },
  ],
  firstActiveDay: "2026-10-05",
  cards: 751,
  sessions: 4,
  workspaces: 2,
  shares: 1,
  apps: 3,
  invitesSent: 5,
  pukuRequests: 12,
  summary: { active7: 2, active30: 2, streak: 1, longest: 1, peakCards: 93 },
};

afterEach(() => vi.clearAllMocks());

describe("UserActivityDrawer", () => {
  it("loads the account's activity and draws it", async () => {
    api.adminGet.mockResolvedValueOnce(ANSWER);
    render(<UserActivityDrawer user={USER} onClose={() => {}} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("2/7")).toBeInTheDocument();
    expect(api.adminGet).toHaveBeenCalledWith("/api/admin/users/u1/activity");
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("751")).toBeInTheDocument();
    expect(screen.getByText("History from 2026-10-05")).toBeInTheDocument();
    expect(screen.getByText(/peak 93/)).toBeInTheDocument();
    expect(screen.getByText("12 Puku trial requests")).toBeInTheDocument();
    // The calendar cell and its cards-per-day bar.
    expect(screen.getAllByTitle("2026-10-23: 93 cards")).toHaveLength(2);
    expect(screen.getByTitle("2026-10-25: active")).toBeInTheDocument();
  });

  it("leaves out the bars and trial line for an account that doesn't sync", async () => {
    api.adminGet.mockResolvedValueOnce({ ...ANSWER, firstActiveDay: null, pukuRequests: 0, summary: { ...ANSWER.summary, peakCards: 0 } });
    render(<UserActivityDrawer user={{ ...USER, lastSeenAt: null }} onClose={() => {}} />);
    await screen.findByText("2/7");
    expect(screen.queryByText(/peak/)).toBeNull();
    expect(screen.queryByText(/Puku/)).toBeNull();
    expect(screen.getByText("never signed in")).toBeInTheDocument();
  });

  it("shows the error when the read fails", async () => {
    api.adminGet.mockRejectedValueOnce(new Error("function not found"));
    render(<UserActivityDrawer user={USER} onClose={() => {}} />);
    expect(await screen.findByText("function not found")).toBeInTheDocument();
  });

  it("closes on Esc, the backdrop and ✕, and marks Esc handled", async () => {
    api.adminGet.mockResolvedValue(ANSWER);
    const onClose = vi.fn();
    render(<UserActivityDrawer user={USER} onClose={onClose} />);
    const seen: boolean[] = [];
    window.addEventListener("keydown", (e) => seen.push(e.defaultPrevented));
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(seen).toEqual([false, true]);
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByTitle("Close (Esc)"));
    expect(onClose).toHaveBeenCalledTimes(3);
    await screen.findByText("2/7");
  });

  it("takes the Esc for itself, so the page's own Esc (back to the board) doesn't fire", () => {
    api.adminGet.mockResolvedValue(ANSWER);
    const onClose = vi.fn();
    const page = vi.fn();
    // The page's own Esc (AdminEscape) is the layer under the drawer in the repo's Escape stack.
    renderHook(() => useEscape(true, page));
    render(<UserActivityDrawer user={USER} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(page).not.toHaveBeenCalled();
  });
});
