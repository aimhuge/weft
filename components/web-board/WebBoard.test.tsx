// @vitest-environment jsdom
// jsdom test for the /[orgSlug]/board page's client component. The Supabase browser client and
// the project URL/key are mocked so we can drive the Realtime callbacks by hand and assert what the
// board draws: the desktop's columns and cards read-only, the project bar's filters, the thread
// panel and the live INSERT/UPDATE/DELETE path, without a real network. The pure logic
// (webCards, applyCardChange, …) has its own coverage in lib/web-board.test.ts; this is the wiring.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, commandRow, db, mockState, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);

async function loadBoard() {
  return import("./WebBoard");
}

const user = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const orgs = [{ id: "o1", slug: "ada", name: "Ada's team" }, { id: "o2", slug: "lab", name: "Lab" }];
const props = { orgId: "o1", orgSlug: "ada", userId: "u1", user, orgs, initialCommands: [] as CloudCommandRow[], openCardId: null, initialThread: [] as CloudThreadItemRow[], initialBlobUrls: {} };

afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

const column = (id: string) => within(document.querySelector(`[data-column="${id}"]`) as HTMLElement);

describe("WebBoard", () => {
  it("draws the desktop's five columns with their cards and counts", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "old", title: "Older", column: "review" }), cardRow({ card_id: "new", title: "Newer", column: "running" })]} />);
    for (const label of ["Backlog", "Running", "Needs you", "Review", "Done"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(column("review").getByText("Older")).toBeInTheDocument();
    expect(column("running").getByText("Newer")).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText(/1 running/)).toBeInTheDocument();
  });

  it("shows what a card's thread said, its stage and its tags, as the desktop card does", async () => {
    const { WebBoard } = await loadBoard();
    const row = cardRow({ card_id: "x", title: "Rich", column: "review", card: { lastLine: "Added the tests", stage: "Polishing", remaining: "docs", tags: ["web"] } });
    render(<WebBoard {...props} initialCards={[row]} />);
    expect(screen.getByText("Added the tests")).toBeInTheDocument();
    expect(screen.getByText("Polishing")).toBeInTheDocument();
    expect(screen.getByText("web")).toBeInTheDocument();
  });

  it("counts cards that need you in the header and lights the column", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "n", title: "Asks", column: "needs_you" })]} />);
    expect(within(screen.getByRole("banner")).getByText(/1 needs you/)).toBeInTheDocument();
  });

  it("offers no way to act on a card: no stop, star, archive or drag", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "r", title: "Busy", column: "running" }), cardRow({ card_id: "d", title: "Finished", column: "done" })]} />);
    expect(screen.queryByLabelText("Stop this thread")).not.toBeInTheDocument();
    // The rail's ★ filters the board (the desktop's own button), but a card carries no star of its own.
    expect(within(screen.getByRole("navigation", { name: "Rail" })).getByRole("button", { name: /Starred cards/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Star this card")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/archive/i)).not.toBeInTheDocument();
    expect(document.querySelector("[draggable=true]")).toBeNull();
  });

  it("shows the empty state and points at Sync in the desktop app when there are no cards", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[]} />);
    expect(screen.getByText(/turn on Sync for a project in the Weft desktop app/)).toBeInTheDocument();
    expect(screen.getByText("Settings → Sync")).toBeInTheDocument();
    expect(screen.queryByText("Backlog")).not.toBeInTheDocument();
  });

  it("flips the live dot to Live after the channel reports SUBSCRIBED", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow()]} />);
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Live")).toBeInTheDocument());
  });

  it("filters by project chip and by the filter box, and sorts", async () => {
    const { WebBoard } = await loadBoard();
    render(
      <WebBoard
        {...props}
        initialCards={[
          cardRow({ card_id: "a", title: "In app", folder: "/Users/me/dev/app" }),
          cardRow({ card_id: "b", title: "In site", folder: "/Users/me/dev/site", card: { lastLine: "wrote the footer" } }),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^site/ }));
    expect(screen.queryByText("In app")).not.toBeInTheDocument();
    expect(screen.getByText("In site")).toBeInTheDocument();
    // All brings the other project's card back, as on the desktop.
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(screen.getByText("In app")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter cards"), { target: { value: "footer" } });
    expect(screen.queryByText("In app")).not.toBeInTheDocument();
    expect(screen.getByText("In site")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter cards"), { target: { value: "zzz" } });
    expect(screen.getAllByText("No matching cards").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Sort cards"), { target: { value: "oldest" } });
    expect(screen.getByLabelText("Sort cards")).toHaveValue("oldest");
  });

  it("hides archived cards until the Done column's toggle shows them", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "z", title: "Filed away", column: "done", card: { archived: true } })]} />);
    expect(screen.queryByText("Filed away")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show 1 archived/ }));
    expect(screen.getByText("Filed away")).toBeInTheDocument();
  });

  it("folds a long column behind Show N more", async () => {
    const { WebBoard } = await loadBoard();
    const rows = Array.from({ length: 42 }, (_, i) => cardRow({ card_id: `k${i}`, title: `Card ${i}`, column: "backlog" }));
    render(<WebBoard {...props} initialCards={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it("applies a Realtime INSERT for cloud_cards and adds the new card to its column", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", title: "A", column: "backlog" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "INSERT", new: cardRow({ card_id: "b", title: "Newly arrived", column: "review" }), old: null });
    await waitFor(() => expect(column("review").getByText("Newly arrived")).toBeInTheDocument());
  });

  it("applies a Realtime UPDATE that moves a card to a different column", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "c1", title: "Moving", column: "backlog" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "UPDATE", new: cardRow({ card_id: "c1", title: "Moving", column: "review" }), old: { card_id: "c1" } });
    await waitFor(() => expect(column("review").getByText("Moving")).toBeInTheDocument());
    expect(column("backlog").queryByText("Moving")).not.toBeInTheDocument();
  });

  it("removes a card when Realtime reports a DELETE", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", title: "Stay" }), cardRow({ card_id: "b", title: "Leave" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "DELETE", new: null, old: { card_id: "b" } });
    await waitFor(() => expect(screen.queryByText("Leave")).not.toBeInTheDocument());
    expect(screen.getByText("Stay")).toBeInTheDocument();
  });

  it("ignores a Realtime payload with neither a new nor an old row", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ title: "Still here" })]} />);
    await waitFor(() => expect(mockState.clients).toHaveLength(1));
    mockState.clients[0]!.trigger("cloud_cards", { eventType: "UPDATE", new: null, old: null });
    expect(screen.getByText("Still here")).toBeInTheDocument();
  });
});


describe("WebBoard starting a thread on your Mac", () => {
  const mine = [cardRow({ card_id: "a", folder: "/Users/me/dev/app", column: "review" })];
  const open = async (cards = mine) => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={cards} />);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    return screen.getByRole("dialog");
  };

  it("offers your synced folders, and sends the prompt to the Mac that owns the folder", async () => {
    const dialog = await open();
    const project = within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Project" });
    expect(project.selectedOptions[0]?.textContent).toBe("app");
    fireEvent.change(within(dialog).getByLabelText("Prompt"), { target: { value: "  Add a dark mode  " } });
    fireEvent.change(within(dialog).getByLabelText("Model"), { target: { value: "claude-opus-5-5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start on my Mac" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockState.inserts).toEqual([
      {
        table: "cloud_commands",
        row: { org_id: "o1", kind: "new_card", target_device: "mac-1", folder: "/Users/me/dev/app", payload: { prompt: "Add a dark mode", backend: "claude", model: "claude-opus-5-5" } },
      },
    ]);
    // Until the Mac has it, the board says so.
    expect(screen.getByRole("list", { name: "Threads sent to your Mac" })).toHaveTextContent(/Add a dark mode.*Waiting for your Mac/);
  });

  it("will not send an empty prompt", async () => {
    const dialog = await open();
    expect(within(dialog).getByRole("button", { name: "Start on my Mac" })).toBeDisabled();
  });

  it("says why it couldn't be sent and keeps the prompt", async () => {
    db.insertError = "new row violates row-level security policy";
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText("Prompt"), { target: { value: "Do it" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start on my Mac" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("row-level security");
    expect(within(dialog).getByLabelText("Prompt")).toHaveValue("Do it");
  });

  it("sends with ⌘↵ in the prompt", async () => {
    const dialog = await open();
    const prompt = within(dialog).getByLabelText("Prompt");
    fireEvent.change(prompt, { target: { value: "Go" } });
    fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
  });

  it("starts in the selected project", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", folder: "/dev/one" }), cardRow({ card_id: "b", folder: "/dev/two", updated_at: "2026-10-01T00:00:00Z" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /^two/ }));
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Project" }).selectedOptions[0]?.textContent).toBe("two");
  });

  it("closes without sending", async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockState.inserts).toEqual([]);
  });

  it("has nowhere to start when none of the synced folders are yours", async () => {
    const dialog = await open([cardRow({ card_id: "t", owner_user: "u2" })]);
    expect(dialog).toHaveTextContent(/No folder to start it in yet/);
    expect(within(dialog).queryByRole("button", { name: "Start on my Mac" })).toBeNull();
  });
});

describe("WebBoard threads sent to your Mac", () => {
  const sentTo = async (commands: ReturnType<typeof commandRow>[]) => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", folder: "/dev/app" })]} initialCommands={commands} />);
  };
  const push = (payload: unknown) => act(() => mockState.clients[0]?.trigger("cloud_commands", payload));

  it("shows each one that is on its way, and takes a pending one back", async () => {
    await sentTo([commandRow({ id: "p", payload: { prompt: "First" } }), commandRow({ id: "q", status: "claimed", payload: { prompt: "Second" } })]);
    const list = screen.getByRole("list", { name: "Threads sent to your Mac" });
    expect(within(list).getByText("First")).toBeInTheDocument();
    expect(list).toHaveTextContent(/Starting on your Mac/);
    fireEvent.click(within(list).getAllByRole("button", { name: "Cancel" })[0] as HTMLElement);
    await waitFor(() => expect(within(list).queryByText("First")).toBeNull());
    expect(mockState.deletes[0]).toMatchObject({ table: "cloud_commands", filters: [["id", "p"]] });
  });

  it("keeps a command the database wouldn't delete", async () => {
    db.deleteError = "denied";
    await sentTo([commandRow({ id: "p", payload: { prompt: "Stuck" } })]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mockState.deletes).toHaveLength(1));
    expect(screen.getByText("Stuck")).toBeInTheDocument();
  });

  it("follows the Mac claiming and failing it, and clears a failure", async () => {
    await sentTo([commandRow({ id: "p", payload: { prompt: "Try me" } })]);
    push({ eventType: "UPDATE", new: commandRow({ id: "p", payload: { prompt: "Try me" }, status: "claimed" }), old: {} });
    expect(await screen.findByText(/Starting on your Mac/)).toBeInTheDocument();
    push({ eventType: "UPDATE", new: commandRow({ id: "p", payload: { prompt: "Try me" }, status: "failed", error: "Not switched on in Settings → Sync" }), old: {} });
    expect(await screen.findByText(/Not switched on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Try me")).toBeNull());
  });

  it("ignores a teammate's commands, and drops one that was deleted", async () => {
    await sentTo([commandRow({ id: "p", payload: { prompt: "Mine" } })]);
    push({ eventType: "INSERT", new: commandRow({ id: "t", created_by: "u2", payload: { prompt: "Theirs" } }), old: null });
    expect(screen.queryByText("Theirs")).toBeNull();
    push({ eventType: "DELETE", new: null, old: { id: "p" } });
    await waitFor(() => expect(screen.queryByText("Mine")).toBeNull());
    expect(screen.queryByRole("list", { name: "Threads sent to your Mac" })).toBeNull();
  });

  it("opens the card a thread became, once it has synced back", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", folder: "/Users/me/dev/app" })]} />);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Build it" } });
    fireEvent.click(screen.getByRole("button", { name: "Start on my Mac" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The Mac reports it done a moment before the card's own row lands…
    push({ eventType: "UPDATE", new: commandRow({ id: "cmd-1", status: "done", card_id: "made", payload: { prompt: "Build it" } }), old: {} });
    expect(screen.queryByRole("dialog")).toBeNull();
    // …and the card opens when it does.
    act(() => mockState.clients[0]?.trigger("cloud_cards", { eventType: "INSERT", new: cardRow({ card_id: "made", title: "Build it", column: "running" }), old: null }));
    expect(await screen.findByRole("dialog", { name: /Build it/i })).toBeInTheDocument();
  });

  it("doesn't open a card for a command sent from another tab", async () => {
    await sentTo([]);
    push({ eventType: "UPDATE", new: commandRow({ id: "elsewhere", status: "done", card_id: "other" }), old: {} });
    act(() => mockState.clients[0]?.trigger("cloud_cards", { eventType: "INSERT", new: cardRow({ card_id: "other", title: "Other", column: "running" }), old: null }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
