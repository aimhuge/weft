// @vitest-environment jsdom
// New thread on weft.zip (docs/architecture/new-card-parity.md), through <WebBoard>: at desktop widths it is the
// desktop's own NewCardDialog given the cloud transport, so the prompt, model, mode, worktree and Backlog go to the Mac
// that owns the folder as a `new_card` command; at phone widths it is the phone app's design over the same state.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudThreadItemRow } from "@/lib/cloud-sync-types";
import { pickModel } from "../model-picker-test-utils";
import "../test-utils";
import { cardRow, commandRow, db, mockState, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);
vi.mock("../Composer", () => import("../composer-mock"));

const loadBoard = () => import("./WebBoard");
const user = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const orgs = [{ id: "o1", slug: "ada", name: "Ada's team" }];
const props = { orgId: "o1", orgSlug: "ada", userId: "u1", user, orgs, initialCommands: [] as CloudCommandRow[], openCardId: null, initialThread: [] as CloudThreadItemRow[], initialBlobUrls: {} };
const mine = [cardRow({ card_id: "a", folder: "/Users/me/dev/app", column: "review" })];

beforeAll(async () => {
  await loadBoard();
}, 60_000);

afterEach(() => {
  resetHarness();
  localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

// Phone width or not, as the browser's media query answers.
function width(phone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: phone, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

async function open(cards = mine) {
  const { WebBoard } = await loadBoard();
  render(<WebBoard {...props} initialCards={cards} />);
  fireEvent.click(screen.getByRole("button", { name: "New thread" }));
  return screen.getByRole("dialog", { name: "New thread" });
}

const write = (dialog: HTMLElement, text: string) => fireEvent.change(within(dialog).getByRole("textbox", { name: "Message" }), { target: { value: text } });
const start = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: /^Start/ }));
const sent = () => mockState.inserts[0]?.row as { kind: string; target_device: string; folder: string; payload: Record<string, unknown> };

describe("New thread on weft.zip at desktop width", () => {
  it("is the desktop dialog, and sends the prompt to the Mac that owns the folder", async () => {
    const dialog = await open();
    expect(within(dialog).getByRole<HTMLSelectElement>("combobox", { name: "Where it runs" }).selectedOptions[0]?.textContent).toBe("app");
    write(dialog, "  Add a dark mode  ");
    pickModel("Model", "Opus 5.5", within(dialog));
    start(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull());
    expect(sent()).toEqual({ org_id: "o1", kind: "new_card", target_device: "mac-1", folder: "/Users/me/dev/app", payload: { prompt: "Add a dark mode", backend: "claude", model: "claude-opus-5-5", effort: "high" } });
    expect(screen.getByRole("list", { name: "Threads sent to your Mac" })).toHaveTextContent(/Add a dark mode.*Waiting for your Mac/);
  });

  it("opens the mode on what the Mac starts it in, and sends none until you pick", async () => {
    db.workers = [{ device: "mac-1", capabilities: { startMode: "default" } }];
    const dialog = await open();
    expect(await within(dialog).findByRole("button", { name: /^Permissions: Ask me/ })).toBeInTheDocument();
    write(dialog, "Careful");
    start(dialog);
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(sent().payload).not.toHaveProperty("permissionMode");
  });

  it("offers no cron, no Agent and no skip-permissions from a browser", async () => {
    const dialog = await open();
    expect(within(dialog).queryByRole("button", { name: "Run on a cron" })).toBeNull();
    expect(within(dialog).queryByText("Agent")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /^Permissions:/ }));
    expect(within(dialog).queryByRole("menuitemradio", { name: /YOLO/ })).toBeNull();
  });

  it("sends the mode you pick, a worktree on a named branch, and Backlog", async () => {
    const dialog = await open();
    write(dialog, "Later");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Permissions:/ }));
    fireEvent.click(within(dialog).getByRole("menuitemradio", { name: /Accept edits/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Isolation:/ }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Worktree" }));
    const branch = within(dialog).getByRole("textbox", { name: "Branch" });
    fireEvent.change(branch, { target: { value: "feat/dark" } });
    fireEvent.blur(branch);
    fireEvent.click(within(dialog).getByRole("button", { name: /^Add to backlog/ }));
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(sent().payload).toMatchObject({ prompt: "Later", permissionMode: "acceptEdits", isolated: true, branch: "feat/dark", start: false });
  });

  it("on a worker's folder offers Plan first and no Backlog", async () => {
    const dialog = await open([cardRow({ card_id: "w", folder: "app", owner_device: "worker:w1" })]);
    expect(within(dialog).getByRole("button", { name: /^Add to backlog/ })).toBeDisabled();
    write(dialog, "Think");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Plan first" }));
    start(dialog);
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(sent()).toMatchObject({ target_device: "worker:w1", payload: { prompt: "Think", permissionMode: "plan" } });
  });

  it("says why it couldn't be sent and stays open", async () => {
    db.insertError = "new row violates row-level security policy";
    const dialog = await open();
    write(dialog, "Do it");
    start(dialog);
    expect(await within(dialog).findByText(/row-level security/)).toBeInTheDocument();
  });

  it("will not send an empty prompt", async () => {
    const dialog = await open();
    start(dialog);
    await act(async () => {});
    expect(mockState.inserts).toEqual([]);
  });

  it("starts in the selected project", async () => {
    const { WebBoard } = await loadBoard();
    render(<WebBoard {...props} initialCards={[cardRow({ card_id: "a", folder: "/dev/one" }), cardRow({ card_id: "b", folder: "/dev/two", updated_at: "2026-10-01T00:00:00Z" })]} />);
    fireEvent.click(screen.getByRole("button", { name: /^two/ }));
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Where it runs" }).selectedOptions[0]?.textContent).toBe("two");
  });

  it("closes without sending", async () => {
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull();
    expect(mockState.inserts).toEqual([]);
  });

  it("says where to turn on Sync when none of the synced folders are yours", async () => {
    const dialog = await open([cardRow({ card_id: "t", owner_user: "u2" })]);
    expect(dialog).toHaveTextContent(/No folder to start it in yet/);
  });

  it("opens the card a thread became, once it has synced back", async () => {
    const dialog = await open([cardRow({ card_id: "a", folder: "/Users/me/dev/app" })]);
    write(dialog, "Build it");
    start(dialog);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New thread" })).toBeNull());
    act(() => mockState.clients[0]?.trigger("cloud_commands", { eventType: "UPDATE", new: commandRow({ id: "cmd-1", status: "done", card_id: "made", payload: { prompt: "Build it" } }), old: {} }));
    act(() => mockState.clients[0]?.trigger("cloud_cards", { eventType: "INSERT", new: cardRow({ card_id: "made", title: "Build it", column: "running" }), old: null }));
    expect(await screen.findByRole("dialog", { name: /Build it/i })).toBeInTheDocument();
  });
});

describe("New thread on weft.zip at phone width", () => {
  it("is the phone design: chips above a typed prompt, and ↑ starts it", async () => {
    width(true);
    const dialog = await open();
    expect(within(dialog).getByRole("group", { name: "New thread options" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Type instead" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Prompt" }), { target: { value: "From my phone" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Isolation" }), { target: { value: "worktree" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(sent().payload).toMatchObject({ prompt: "From my phone", isolated: true });
  });

  it("offers Plan first as a chip on a worker", async () => {
    width(true);
    const dialog = await open([cardRow({ card_id: "w", folder: "app", owner_device: "worker:w1" })]);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Plan first" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Type instead" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Prompt" }), { target: { value: "Plan it" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start" }));
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(sent().payload).toMatchObject({ prompt: "Plan it", permissionMode: "plan" });
  });

  it("puts Backlog behind ⋯", async () => {
    width(true);
    const dialog = await open();
    fireEvent.click(within(dialog).getByRole("button", { name: "Type instead" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Prompt" }), { target: { value: "Someday" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "More" }));
    fireEvent.click(within(dialog).getByRole("menuitem", { name: "Add to Backlog" }));
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(sent().payload).toMatchObject({ prompt: "Someday", start: false });
  });
});
