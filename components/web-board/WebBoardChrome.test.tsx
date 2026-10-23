// @vitest-environment jsdom
// The weft.zip board's desktop chrome: the header's account menu (workspaces, Team, Billing, Sign out), the rail's ★
// filter and page links, N for New thread, and the open card's browser pane beside its thread. Same harness as
// WebBoard.test.tsx.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, itemRow, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);

const user = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const orgs = [{ id: "o1", slug: "ada", name: "Ada's team" }, { id: "o2", slug: "lab", name: "Lab" }];
const props = { orgId: "o1", orgSlug: "ada", userId: "u1", user, orgs, initialCommands: [] as CloudCommandRow[], openCardId: null as string | null, initialThread: [] as CloudThreadItemRow[], initialBlobUrls: {} };
const SHA = "c".repeat(64);

async function board(over: Partial<typeof props> & { initialCards?: ReturnType<typeof cardRow>[] } = {}) {
  const { WebBoard } = await import("./WebBoard");
  return render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", title: "Plain" }), cardRow({ card_id: "b", title: "Starred one", card: { starred: true } })]} {...over} />);
}

afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

describe("WebBoard desktop chrome", () => {
  it("draws the desktop header: Weft, the workspace, and no sidebar's worth of nav", async () => {
    await board();
    const banner = within(screen.getByRole("banner"));
    expect(banner.getByText("Weft")).toBeInTheDocument();
    expect(banner.getByText("Ada's team")).toBeInTheDocument();
  });

  it("opens the account menu with the workspaces' boards, Team, Billing and Sign out", async () => {
    await board();
    fireEvent.click(screen.getByRole("button", { name: "Account: Ada" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByRole("menuitem", { name: /Lab/ })).toHaveAttribute("href", "/lab/board");
    expect(menu.getByRole("menuitem", { name: /Ada's team/ })).toHaveAttribute("aria-current", "true");
    expect(menu.getByRole("menuitem", { name: "Team" })).toHaveAttribute("href", "/ada/team");
    expect(menu.getByRole("menuitem", { name: "Billing" })).toHaveAttribute("href", "/ada/billing");
    expect(menu.getByRole("menuitem", { name: "Sign out" }).closest("form")).toHaveAttribute("action", "/auth/sign-out");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("filters to starred cards from the rail's ★, and links the workspace's pages", async () => {
    await board();
    const rail = within(screen.getByRole("navigation", { name: "Rail" }));
    expect(rail.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    expect(rail.getByRole("link", { name: "Team" })).toHaveAttribute("href", "/ada/team");
    fireEvent.click(rail.getByRole("button", { name: "Starred" }));
    expect(screen.queryByText("Plain")).toBeNull();
    expect(screen.getByText("Starred one")).toBeInTheDocument();
    fireEvent.click(rail.getByRole("button", { name: "Starred" }));
    expect(screen.getByText("Plain")).toBeInTheDocument();
  });

  it("opens New thread on N, but not while typing in a field", async () => {
    await board();
    fireEvent.keyDown(screen.getByLabelText("Filter cards"), { key: "n" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "n", metaKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(screen.getByLabelText("Prompt")).toBeInTheDocument();
  });

  it("starts a thread from the Backlog's Add a thread, as on the desktop", async () => {
    await board();
    fireEvent.click(screen.getByRole("button", { name: /Add a thread/ }));
    expect(screen.getByLabelText("Prompt")).toBeInTheDocument();
  });

  it("frames the open card's synced page beside its thread through the member-gated route", async () => {
    const opened = [itemRow(0, { kind: "tool", id: "t1", name: "mcp__browser__open_url", summary: `blob:sha256:${SHA}#login`, at: 5 } as never, "a")];
    await board({ openCardId: "a", initialThread: opened });
    const pane = within(screen.getByRole("region", { name: "Browser pane" }));
    expect(pane.getByTitle("Card page")).toHaveAttribute("src", `/api/web-board/o1/page/${SHA}#login`);
  });

  it("frames a public site with an Open link, and shows the capture for a page only the Mac can reach", async () => {
    const site = [itemRow(0, { kind: "tool", id: "t1", name: "mcp__browser__open_url", summary: "https://example.com/docs", at: 5 } as never, "a")];
    const { unmount } = await board({ openCardId: "a", initialThread: site });
    expect(screen.getByRole("link", { name: /Open ↗/ })).toHaveAttribute("href", "https://example.com/docs");
    // The address bar shows the site's host, not the whole URL.
    expect(screen.getByLabelText("Page address")).toHaveValue("example.com");
    unmount();
    resetHarness();
    const local = [itemRow(0, { kind: "tool", id: "t1", name: "mcp__browser__open_url", summary: "http://localhost:3000/", at: 5 } as never, "a")];
    await board({ openCardId: "a", initialThread: local, initialCards: [cardRow({ card_id: "a", title: "Local", card: { thumb: "https://signed/thumb.png" } })] });
    expect(screen.getByAltText("The card's last pane capture")).toHaveAttribute("src", "https://signed/thumb.png");
  });

  it("says so when the card's pane never opened a page, and shows the session like the desktop header", async () => {
    await board({ openCardId: "a", initialCards: [cardRow({ card_id: "a", title: "Quiet", card: { sessionId: "abcdef1234567890", stage: "Polishing", remaining: "tests" } })] });
    expect(screen.getByText("No page open in this card's browser pane.")).toBeInTheDocument();
    expect(screen.getByText("· abcdef12")).toBeInTheDocument();
    expect(screen.getByText("Left: tests")).toBeInTheDocument();
    expect(screen.queryByText(/mac-1/)).toBeNull();
  });
});
