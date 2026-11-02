// @vitest-environment jsdom
// The weft.zip board acting on your own cards with the desktop's own code (components/web-board/useWebCards.tsx): the
// tile's ★, Stop, archive with Undo and Allow, drag between columns, the right-click menu (WebMenu.tsx), the held-edit
// choices, the open card's header and ⌘F over the whole thread. Each is a `host` row (or the old kind) for the machine
// that runs the card, drawn on the board at once. The Supabase client is the harness's.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudCardRow, CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, db, itemRow, mockState, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);
vi.mock("../Composer", () => import("../composer-mock"));
// A worker's live screen: its frames come when the test says.
const stream = vi.hoisted(() => ({ onFrame: null as ((src: string) => void) | null }));
vi.mock("@/lib/use-screen-stream", async (actual) => ({
  ...(await actual<typeof import("@/lib/use-screen-stream")>()),
  useScreenStream: (_: string, onFrame: (src: string) => void) => {
    stream.onFrame = onFrame;
  },
}));

const user = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const orgs = [{ id: "o1", slug: "ada", name: "Ada's team" }];
const props = { orgId: "o1", orgSlug: "ada", userId: "u1", user, orgs, initialCommands: [] as CloudCommandRow[], openCardId: null as string | null, initialThread: [] as CloudThreadItemRow[], initialBlobUrls: {} };

afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

async function board(cards: CloudCardRow[], over: Partial<typeof props> = {}) {
  const { WebBoard } = await import("./WebBoard");
  return render(<WebBoard {...props} {...over} initialCards={cards} />);
}

const rows = () => mockState.inserts.map((i) => i.row as { kind: string; target_device: string; folder: string; payload: { verb?: string; args?: Record<string, unknown> } & Record<string, unknown> });
const hostRows = () => rows().filter((r) => r.kind === "host").map((r) => r.payload);
const column = (id: string) => document.querySelector(`[data-column="${id}"]`) as HTMLElement;
const tile = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement;

describe("your own card's tile", () => {
  it("stars it as a card.update for the card's Mac, drawn starred at once", async () => {
    await board([cardRow({ card_id: "c1", title: "Mine", column: "review" })]);
    fireEvent.click(within(tile("c1")).getByRole("button", { name: "Star" }));
    expect(within(tile("c1")).getByRole("button", { name: "Starred" })).toBeInTheDocument();
    await waitFor(() => expect(hostRows()).toEqual([{ verb: "card.update", args: { id: "c1", body: { starred: true } } }]));
    expect(rows()[0]).toMatchObject({ target_device: "mac-1", folder: "/Users/me/dev/app" });
  });

  it("stops a running card as card.stop, out of Running at once", async () => {
    await board([cardRow({ card_id: "c1", title: "Busy", column: "running" })]);
    fireEvent.click(within(tile("c1")).getByRole("button", { name: "Stop this thread" }));
    await waitFor(() => expect(hostRows()).toEqual([{ verb: "card.stop", args: { id: "c1" } }]));
    expect(within(column("review")).getByText("Busy")).toBeInTheDocument();
  });

  it("archives a Done card with an Undo that files it back", async () => {
    await board([cardRow({ card_id: "c1", title: "Shipped", column: "done" })]);
    fireEvent.click(within(tile("c1")).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(hostRows()).toEqual([{ verb: "card.update", args: { id: "c1", body: { archived: true } } }]));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(hostRows().at(-1)).toEqual({ verb: "card.update", args: { id: "c1", body: { archived: false } } }));
  });

  it("answers its permission prompt the way the open thread does: an answer command", async () => {
    const pending = { id: "p1", tool: "Bash", toolName: "Bash", title: "Run ls", input: { command: "ls" } };
    await board([cardRow({ card_id: "c1", title: "Asks", column: "needs_you", card: { pending } })]);
    fireEvent.click(within(tile("c1")).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(rows()[0]).toMatchObject({ kind: "answer", payload: { cardId: "c1", pendingId: "p1", allow: true } }));
  });

  it("sends a held edit's Wait as card.permission.wait", async () => {
    const pending = { id: "p1", tool: "Edit", toolName: "Edit", title: "Edit a.ts", input: {}, why: { holder: { id: "c9", title: "Other", emoji: "🦊" } } };
    await board([cardRow({ card_id: "c1", title: "Held", column: "needs_you", card: { pending } as never })]);
    fireEvent.click(within(tile("c1")).getByRole("button", { name: "Wait" }));
    await waitFor(() => expect(hostRows()).toEqual([{ verb: "card.permission.wait", args: { id: "c1", pendingId: "p1" } }]));
  });

  it("moves to the column it's dropped on, as card.update", async () => {
    await board([cardRow({ card_id: "c1", title: "Drag me", column: "review" })]);
    expect(tile("c1").getAttribute("draggable")).toBe("true");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(tile("c1"), { dataTransfer });
    fireEvent.drop(column("done"), { dataTransfer });
    await waitFor(() => expect(hostRows()).toEqual([{ verb: "card.update", args: { id: "c1", body: { column: "done" } } }]));
    expect(within(column("done")).getByText("Drag me")).toBeInTheDocument();
  });
});

describe("the right-click menu", () => {
  it("is the remote menu, drawn at the pointer, and runs what you pick through the card's host", async () => {
    await board([cardRow({ card_id: "c1", title: "Menu me", column: "review" })]);
    fireEvent.contextMenu(tile("c1"), { clientX: 40, clientY: 50 });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /Rename/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: /Reveal/ })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Move to Done/ }));
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(hostRows()).toEqual([{ verb: "card.update", args: { id: "c1", body: { column: "done" } } }]));
  });

  it("closes on Escape with nothing picked, and opens Tags… as the desktop's dialog", async () => {
    await board([cardRow({ card_id: "c1", title: "Tag me", column: "review" })]);
    fireEvent.contextMenu(tile("c1"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.contextMenu(tile("c1"));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Tags/ }));
    expect(await screen.findByRole("dialog", { name: /Tags/i })).toBeInTheDocument();
    expect(hostRows()).toEqual([]);
  });

  it("offers a column's Archive all on Done", async () => {
    await board([cardRow({ card_id: "c1", title: "One", column: "done" }), cardRow({ card_id: "c2", title: "Two", column: "done" })]);
    fireEvent.contextMenu(column("done"));
    fireEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: /Archive/ }));
    await waitFor(() => expect(hostRows()).toHaveLength(2));
  });
});

describe("the open card", () => {
  const open = (over: Partial<Parameters<typeof cardRow>[0]> = {}) => [cardRow({ card_id: "c1", title: "Open me", column: "review", ...over })];

  it("renames from the header as card.update", async () => {
    await board(open(), { openCardId: "c1" });
    const dialog = screen.getByRole("dialog", { name: /Open me/ });
    fireEvent.click(within(dialog).getByTitle("Click to rename"));
    const field = within(dialog).getByDisplayValue("Open me");
    fireEvent.change(field, { target: { value: "Renamed" } });
    fireEvent.blur(field);
    await waitFor(() => expect(hostRows()).toEqual([{ verb: "card.update", args: { id: "c1", body: { title: "Renamed" } } }]));
  });

  it("keeps a teammate's header to itself: no rename, no ★ or archive", async () => {
    await board(open({ owner_user: "u2" }), { openCardId: "c1" });
    const dialog = screen.getByRole("dialog", { name: /Open me/ });
    expect(within(dialog).queryByTitle("Click to rename")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Archive" })).toBeNull();
  });

  it("finds over the whole thread with ⌘F, reading rows it hasn't loaded", async () => {
    // jsdom measures no ranges; the find bar's highlight asks for one.
    Range.prototype.getBoundingClientRect = () => new DOMRect();
    db.items = [itemRow(0, { kind: "assistant", text: "the needle", at: 1 }), itemRow(1, { kind: "assistant", text: "hay", at: 2 })];
    await board(open(), { openCardId: "c1", initialThread: db.items });
    await act(async () => {
      fireEvent.keyDown(document, { key: "f", metaKey: true });
      await Promise.resolve();
    });
    const field = await screen.findByPlaceholderText("Find in thread");
    fireEvent.change(field, { target: { value: "needle" } });
    await waitFor(() => expect(mockState.queries.some((q) => q.filters.some(([k]) => k === "seq>"))).toBe(true));
  });

  it("draws file names as plain text, with no editor to open them in", async () => {
    db.items = [
      itemRow(0, { kind: "assistant", text: "See `lib/turn.ts`", at: 1 }),
      itemRow(1, { kind: "tool", id: "t1", name: "Read", summary: "turn.ts", file: "lib/turn.ts", result: "x", at: 2 } as never),
    ];
    await board(open(), { openCardId: "c1", initialThread: db.items });
    const dialog = screen.getByRole("dialog", { name: /Open me/ });
    expect(await within(dialog).findByText("lib/turn.ts")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("markdown-file-link")).toBeNull();
    expect(within(dialog).queryByTestId("tool-open-file")).toBeNull();
  });

  it("sends a tap on a worker's live screen as an input command for its worker", async () => {
    Element.prototype.setPointerCapture = () => {};
    const { screenPage } = await import("@/lib/share-types");
    const page = screenPage("ab".repeat(16), { id: "d", name: "iPhone" }, Date.now() + 60_000);
    await board(open({ owner_device: "worker:w1", card: { page } }), { openCardId: "c1" });
    act(() => stream.onFrame?.("data:image/jpeg;base64,x"));
    const img = screen.getByAltText("iPhone's screen");
    img.getBoundingClientRect = () => new DOMRect(0, 0, 100, 200);
    fireEvent.pointerDown(img, { clientX: 1, clientY: 1 });
    fireEvent.pointerUp(img, { clientX: 1, clientY: 1 });
    await waitFor(() => expect(rows()[0]).toMatchObject({ kind: "input", target_device: "worker:w1", payload: { cardId: "c1", kind: "tap", device: "d" } }));
  });

  it("draws the show rail beside the pane", async () => {
    await board(open(), { openCardId: "c1" });
    expect(within(screen.getByRole("dialog", { name: /Open me/ })).getByRole("complementary", { name: "Show" })).toBeInTheDocument();
  });
});
