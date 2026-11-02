// @vitest-environment jsdom
// The weft.zip board's thread panel, through <WebBoard>: the desktop's own ThreadPanel over the cloud transport, so
// the open card's messages oldest first with tool calls folded, paging, live items, signed pictures and trimmed tool
// results. The Supabase client is the harness's (components/web-board/web-board-harness.ts); Composer is the
// components' textarea stand-in.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, db, itemRow, mockState, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);
vi.mock("../Composer", () => import("../composer-mock"));

async function loadBoard() {
  return import("./WebBoard");
}

// The thread's folded runs: the header's CLI and mode pickers are menu buttons too.
const folded = (dialog: HTMLElement) => within(dialog).getAllByRole("button", { expanded: false }).filter((b) => !b.closest("header"))[0]!;

const user = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const orgs = [{ id: "o1", slug: "ada", name: "Ada's team" }, { id: "o2", slug: "lab", name: "Lab" }];
const props = { orgId: "o1", orgSlug: "ada", userId: "u1", user, orgs, initialCommands: [] as CloudCommandRow[], openCardId: null, initialThread: [] as CloudThreadItemRow[], initialBlobUrls: {} };

afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

describe("WebBoard thread panel", () => {
  // The server's ?card= seed, and what the thread view then reads for itself.
  const open = (items: CloudThreadItemRow[], over: Partial<CloudCardRow["card"]> = {}) => (db.items = items, {
    ...props,
    openCardId: "c1",
    initialThread: items,
    initialCards: [cardRow({ card_id: "c1", title: "Open me", column: "review", card: over })],
  });

  it("opens the card from the ?card= seed with its thread oldest first, tool calls folded", async () => {
    const { WebBoard } = await loadBoard();
    // Rows come newest first, as the page's query returns them.
    const rows = [
      itemRow(3, { kind: "assistant", text: "All **done**", at: 3 }),
      itemRow(2, { kind: "tool", id: "t1", name: "Bash", summary: "ls", result: "a b", at: 2 }),
      itemRow(1, { kind: "user", text: "please list files", at: 1 }),
    ];
    render(<WebBoard {...open(rows)} />);
    const dialog = screen.getByRole("dialog", { name: /Open me/i });
    const text = dialog.textContent;
    const run = folded(dialog).textContent;
    // Oldest first: the question, the folded tool run, then the answer.
    expect(text.indexOf("please list files")).toBeLessThan(text.indexOf(run));
    expect(text.indexOf(run)).toBeLessThan(text.indexOf("All"));
    expect(within(dialog).getByText("done").tagName).toBe("STRONG");
    expect(await within(dialog).findByRole("textbox", { name: "Message" })).toBeInTheDocument();
  });

  it("draws a teammate's card with the desktop panel's header read-only: the CLI as a badge, no rename, no card actions", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} openCardId="c1" initialCards={[cardRow({ card_id: "c1", title: "Open me", column: "review", owner_user: "u2", card: { tags: ["bug"] } })]} />);
    const dialog = screen.getByRole("dialog", { name: /Open me/i });
    expect(within(dialog).queryByTitle("Click to rename")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /Archive/i })).toBeNull();
    expect(within(dialog).getByText("bug")).toBeInTheDocument();
  });

  it("opens a card on click: fetches its thread, writes ?card= and shows the messages", async () => {
    const { WebBoard } = await loadBoard();
    const replaceState = vi.spyOn(window.history, "replaceState");
    db.items = [itemRow(1, { kind: "user", text: "hello from the Mac", at: 1 })];
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "c1", title: "Click me", column: "review" })]} />);
    fireEvent.click(screen.getByText("Click me"));
    expect(await screen.findByText("hello from the Mac")).toBeInTheDocument();
    expect(String(replaceState.mock.calls.at(-1)?.[2])).toContain("card=c1");
    const filters = mockState.queries.find((q) => q.table === "cloud_thread_items")?.filters ?? [];
    expect(filters).toContainEqual(["card_id", "c1"]);
  });

  it("an open that finds nothing synced shows an empty thread with its reply box instead of crashing", async () => {
    const { WebBoard } = await loadBoard();
    db.items = [];
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "c1", title: "Click me", column: "review" })]} />);
    fireEvent.click(screen.getByText("Click me"));
    expect(await screen.findByRole("textbox", { name: "Message" })).toBeInTheDocument();
  });

  it("closes on the close button and on Escape, clearing ?card=", async () => {
    const { WebBoard } = await loadBoard();
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(<WebBoard {...open([])} />);
    fireEvent.click(screen.getByRole("button", { name: /Close thread/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(String(replaceState.mock.calls.at(-1)?.[2])).not.toContain("card=");
    fireEvent.click(screen.getByText("Open me"));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes when the backdrop is clicked", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...open([])} />);
    const backdrop = document.querySelector("[data-backdrop]") as HTMLElement;
    fireEvent.click(backdrop);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("adds an item that arrives live, and drops one the desktop deleted", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...open([itemRow(1, { kind: "user", text: "first", at: 1 })])} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_thread_items", { eventType: "INSERT", new: itemRow(2, { kind: "assistant", text: "arrived live", at: 2 }), old: null });
    expect(await screen.findByText("arrived live")).toBeInTheDocument();
    mockState.clients[0]!.trigger("cloud_thread_items", { eventType: "DELETE", new: null, old: { card_id: "c1", seq: 2 } });
    await waitFor(() => expect(screen.queryByText("arrived live")).not.toBeInTheDocument());
  });

  it("pages back from the oldest seq it holds when scrolled to the top, as the desktop does", async () => {
    const { WebBoard } = await loadBoard();
    const page = Array.from({ length: 50 }, (_, i) => itemRow(100 - i, { kind: "assistant", text: `msg ${100 - i}`, at: 100 - i }));
    render(<WebBoard {...open(page)} />);
    db.items = [...page, itemRow(50, { kind: "assistant", text: "an older message", at: 1 })];
    const hint = await screen.findByText("Scroll up for earlier messages");
    fireEvent.scroll(hint.parentElement as HTMLElement);
    expect(await screen.findByText("an older message")).toBeInTheDocument();
    const older = mockState.queries.filter((q) => q.table === "cloud_thread_items").at(-1)?.filters ?? [];
    expect(older).toContainEqual(["seq<", 51]);
  });

  it("shows a screenshot a tool took through its signed URL", async () => {
    const { WebBoard } = await loadBoard();
    const sha = "b".repeat(64);
    db.signed[sha] = `https://test.supabase.co/storage/v1/object/sign/weft-blobs/o1/${sha}?token=t`;
    const rows = [itemRow(1, { kind: "tool", id: "t1", name: "mcp__browser__screenshot", summary: "shot", result: "ok", images: [`blob:sha256:${sha}`], at: 1 })];
    render(<WebBoard {...open(rows)} />);
    await waitFor(() => expect(document.querySelector("img[src*='/object/sign/weft-blobs/']")).not.toBeNull());
  });

  it("fetches a trimmed tool result from cloud_tool_outputs when its row opens", async () => {
    const { WebBoard } = await loadBoard();
    db.toolOutput = "the full output";
    const rows = [itemRow(1, { kind: "tool", id: "t9", name: "Bash", summary: "big", resultBytes: 9000, at: 1 })];
    render(<WebBoard {...open(rows)} />);
    fireEvent.click(folded(screen.getByRole("dialog")));
    const details = document.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("the full output")).toBeInTheDocument();
    const q = mockState.queries.find((x) => x.table === "cloud_tool_outputs");
    expect(q?.filters).toContainEqual(["tool_id", "t9"]);
  });

  it("says so when a trimmed tool result can't be read", async () => {
    const { WebBoard } = await loadBoard();
    db.toolOutput = null;
    const rows = [itemRow(1, { kind: "tool", id: "t9", name: "Bash", summary: "big", resultBytes: 9000, at: 1 })];
    render(<WebBoard {...open(rows)} />);
    fireEvent.click(folded(screen.getByRole("dialog")));
    const details = document.querySelector("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText(/Couldn't load the result/)).toBeInTheDocument();
  });
});
