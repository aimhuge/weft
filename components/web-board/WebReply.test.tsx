// @vitest-environment jsdom
// Replying to a thread from the weft.zip board, through <WebBoard>: the desktop's own reply box sends a `reply` command
// for the card's Mac (a running card's Send now sends a `stop` first), an answer to a waiting request is an `answer`,
// each is followed above the box (not in the board's strip) and dropped once it went, and a teammate's card is
// read-only. The Supabase client is the harness's (components/web-board/web-board-harness.ts); Composer is the
// components' textarea stand-in.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, commandRow, db, mockState, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);
vi.mock("../Composer", () => import("../composer-mock"));

const user = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const orgs = [{ id: "o1", slug: "ada", name: "Ada's team" }];
const base = { orgId: "o1", orgSlug: "ada", userId: "u1", user, orgs, initialCommands: [] as CloudCommandRow[], openCardId: "c1", initialThread: [] as CloudThreadItemRow[], initialBlobUrls: {} };
const reply = (over: Partial<CloudCommandRow> = {}) => commandRow({ id: "r1", kind: "reply", payload: { cardId: "c1", text: "ship it" }, ...over });

afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

type Over = Partial<typeof base> & { owner?: string; column?: "running" | "review"; card?: NonNullable<Parameters<typeof cardRow>[0]>["card"] };

async function board(over: Over = {}) {
  const { WebBoard } = await import("./WebBoard");
  const { owner = "u1", column = "review", card, ...props } = over;
  render(<WebBoard {...base} {...props} initialCards={[cardRow({ card_id: "c1", title: "Open me", column, owner_user: owner, card })]} />);
  return screen.getByRole("dialog", { name: /Open me/i });
}

describe("the web reply box", () => {
  it("sends a reply command to the card's Mac and folder on Enter, then clears", async () => {
    const dialog = await board();
    const box = (await within(dialog).findByRole("textbox", { name: "Message" }));
    fireEvent.change(box, { target: { value: "  ship it " } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(mockState.inserts[0]).toEqual({
      table: "cloud_commands",
      row: { org_id: "o1", kind: "reply", target_device: "mac-1", folder: "/Users/me/dev/app", payload: { cardId: "c1", text: "ship it" } },
    });
    await waitFor(() => expect(box).toHaveValue(""));
    expect(within(dialog).getByText(/Waiting for your Mac/)).toBeInTheDocument();
  });

  // A Claude Code or puku turn takes a reply mid-turn (components/ReplyBox.tsx midTurn), so a Codex card is the one that queues.
  it("holds a reply while a Codex card runs, as the desktop does, and Send now stops the turn first", async () => {
    const dialog = await board({ column: "running", card: { backend: "codex" } });
    const box = await within(dialog).findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "and lint" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await within(dialog).findByText("and lint")).toBeInTheDocument();
    expect(mockState.inserts).toHaveLength(0);
    // The queued row's own Send now.
    fireEvent.click(within(dialog).getAllByRole("button", { name: /Send now/i })[0]!);
    await waitFor(() => expect(mockState.inserts.map((i) => (i.row as { kind: string }).kind)).toEqual(["stop", "reply"]));
  });

  it("answers a waiting permission request through an answer command", async () => {
    const pending = { id: "p1", tool: "Bash", toolName: "Bash", title: "Run ls", input: { command: "ls" } };
    const dialog = await board({ column: "review", card: { pending } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Allow" }));
    await waitFor(() => expect(mockState.inserts).toHaveLength(1));
    expect(mockState.inserts[0]?.row).toMatchObject({ kind: "answer", payload: { cardId: "c1", pendingId: "p1", allow: true } });
  });

  it("keeps a new line on Shift+Enter and sends nothing empty", async () => {
    const dialog = await board();
    const box = (await within(dialog).findByRole("textbox", { name: "Message" }));
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "two" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(mockState.inserts).toHaveLength(0);
  });

  it("says why a send was refused and keeps the text", async () => {
    db.insertError = "new row violates row-level security policy";
    const dialog = await board();
    const box = (await within(dialog).findByRole("textbox", { name: "Message" }));
    fireEvent.change(box, { target: { value: "hi" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(await within(dialog).findByText(/row-level security/)).toBeInTheDocument();
    expect(box).toHaveValue("hi");
  });

  it("follows a reply under the box, not in the board's strip, and drops its row once it went", async () => {
    const dialog = await board({ initialCommands: [reply()] });
    expect(within(dialog).getByText("ship it")).toBeInTheDocument();
    expect(screen.queryAllByText("ship it")).toHaveLength(1);
    mockState.clients[0]?.trigger("cloud_commands", { eventType: "UPDATE", new: reply({ status: "claimed" }), old: null });
    expect(await within(dialog).findByText(/Sending on your Mac/)).toBeInTheDocument();
    mockState.clients[0]?.trigger("cloud_commands", { eventType: "UPDATE", new: reply({ status: "done", card_id: "c1" }), old: null });
    await waitFor(() => expect(within(dialog).queryByText("ship it")).toBeNull());
    expect(mockState.deletes).toEqual([{ table: "cloud_commands", filters: [["id", "r1"]] }]);
  });

  it("lets a failed reply be dismissed, and shows what waits for the turn's end", async () => {
    const dialog = await board({ initialCommands: [reply({ status: "failed", error: "That thread isn't on this Mac anymore." })], card: { scheduled: [{ id: "s1", text: "and then lint", at: 1, afterTurn: true }, { id: "s2", text: "later", at: 9 }] } });
    expect(within(dialog).getByText(/isn't on this Mac/)).toBeInTheDocument();
    expect(within(dialog).getByText("and then lint")).toBeInTheDocument();
    expect(within(dialog).queryByText("later")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(within(dialog).queryByText(/isn't on this Mac/)).toBeNull());
  });

  it("is read-only on a card a teammate's Mac runs", async () => {
    const dialog = await board({ owner: "u2" });
    expect(within(dialog).queryByRole("textbox", { name: "Message" })).toBeNull();
    expect(within(dialog).getByText(/teammate's Mac/)).toBeInTheDocument();
  });
});
