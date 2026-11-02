// @vitest-environment jsdom
// The web reply box's host verbs, through <WebBoard> (H3b): ↑ edit and Send later go as `host` commands for the
// machine that runs the card (lib/cloud-host-acts.ts), the same verbs a worker card's box sends from the desktop,
// and stay out of the board's strip of new threads.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCommandRow } from "@/lib/cloud-commands";
import type { CloudThreadItemRow } from "@/lib/cloud-sync-types";
import "../test-utils";
import { cardRow, db, itemRow, mockState, resetHarness } from "./web-board-harness";

vi.mock("@supabase/ssr", async () => (await import("./web-board-harness")).supabaseSsrMock);
vi.mock("@/lib/supabase-project", async () => (await import("./web-board-harness")).supabaseProjectMock);
vi.mock("../Composer", () => import("../composer-mock"));

const user = { id: "u1", email: "ada@b.co", name: "Ada", avatar: null };
const orgs = [{ id: "o1", slug: "ada", name: "Ada's team" }];
const base = { orgId: "o1", orgSlug: "ada", userId: "u1", user, orgs, initialCommands: [] as CloudCommandRow[], openCardId: "c1", initialBlobUrls: {} };

afterEach(() => {
  resetHarness();
  vi.restoreAllMocks();
});

async function board(items: CloudThreadItemRow[] = []) {
  db.items = items;
  const { WebBoard } = await import("./WebBoard");
  render(<WebBoard {...base} initialThread={items} initialCards={[cardRow({ card_id: "c1", title: "Open me", column: "review", card: { sessionId: "s-1" } })]} />);
  return screen.getByRole("dialog", { name: /Open me/i });
}

const hostRows = () => mockState.inserts.map((i) => i.row as { kind: string; target_device: string; payload: unknown }).filter((r) => r.kind === "host");

describe("the web reply box's host verbs", () => {
  it("replaces the last message with ↑ as a card.message.edit for the card's Mac", async () => {
    const dialog = await board([itemRow(1, { kind: "user", text: "make it blue", at: 1 }), itemRow(2, { kind: "assistant", text: "Done", at: 2 })]);
    const box = await within(dialog).findByRole("textbox", { name: "Message" });
    await userEvent.type(box, "{ArrowUp}");
    expect(box).toHaveValue("make it blue");
    await userEvent.clear(box);
    await userEvent.type(box, "make it red{Enter}");
    await waitFor(() => expect(hostRows()).toHaveLength(1));
    expect(hostRows()[0]).toMatchObject({ target_device: "mac-1", payload: { verb: "card.message.edit", args: { id: "c1", text: "make it red" } } });
    expect(screen.queryByText(/card\.message\.edit/)).toBeNull();
  });

  it("offers Send later and schedules on the card's Mac as card.schedule", async () => {
    const dialog = await board();
    const box = await within(dialog).findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Run the nightly" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "More ways to send" }));
    await userEvent.click(within(dialog).getByRole("menuitem", { name: /Send later/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /In 1 hour/ }));
    await waitFor(() => expect(hostRows()).toHaveLength(1));
    expect(hostRows()[0]).toMatchObject({ payload: { verb: "card.schedule", args: { id: "c1", text: "Run the nightly", at: expect.any(Number) as number } } });
  });

  it("puts a scheduled message back in the box when the Mac refuses it, rather than lose it", async () => {
    db.command = { status: "failed", error: "That time has already passed." };
    const dialog = await board();
    const box = await within(dialog).findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "Run the nightly" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "More ways to send" }));
    await userEvent.click(within(dialog).getByRole("menuitem", { name: /Send later/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /In 1 hour/ }));
    expect(await within(dialog).findByText("That time has already passed.")).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveValue("Run the nightly"));
  });
});
