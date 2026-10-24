// @vitest-environment happy-dom
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeCard, useDeleteDialog } from "./use-delete-dialog";
import { makeCard } from "@/components/test-utils";

const api = vi.hoisted(() => ({ remove: vi.fn(() => Promise.resolve({})) }));
vi.mock("@/lib/client", () => ({ api }));

const card = makeCard({ title: "Fix the login page" });

// Renders the hook and hands back its result, so a test can drive the confirmation.
// A .ts file can't hold JSX, so the probe is built with createElement.
function setup(remove = vi.fn()) {
  let value: ReturnType<typeof useDeleteDialog> | null = null;
  function Probe() {
    value = useDeleteDialog(remove);
    return createElement("div", null, value.dialog);
  }
  render(createElement(Probe));
  return { hook: value!, remove };
}

beforeEach(() => {
  localStorage.clear();
  api.remove.mockClear();
});

describe("useDeleteDialog", () => {
  it("draws nothing until a delete is asked for", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks first, and deletes only once confirmed", async () => {
    const { hook, remove } = setup();
    hook.ask(card);
    // The dialog loads through guarded(), so it arrives a tick later.
    expect(await screen.findByRole("dialog", { name: "Delete card" })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(remove).toHaveBeenCalledWith(card);
    // The dialog closes once the card is gone.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("deletes straight away when the user said not to be asked", () => {
    localStorage.setItem("weft.delete.skipConfirm", "1");
    const { hook, remove } = setup();
    hook.ask(card);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(remove).toHaveBeenCalledWith(card);
  });

  it("keeps the card when the confirmation is cancelled", async () => {
    const { hook, remove } = setup();
    hook.ask(card);
    await screen.findByRole("dialog", { name: "Delete card" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says a running card's turn is stopped", async () => {
    const { hook } = setup();
    hook.ask(makeCard({ column: "running" }));
    expect(await screen.findByText(/This stops its turn\./)).toBeInTheDocument();
  });
});

describe("removeCard", () => {
  it("clears the open card when it was the one going, and tells the server", () => {
    const select = vi.fn();
    removeCard(card, () => true, select, vi.fn());
    expect(select).toHaveBeenCalledWith(null);
    expect(api.remove).toHaveBeenCalledWith(card.id);
  });

  it("leaves the open card alone when a different card is going", () => {
    const select = vi.fn();
    removeCard(card, () => false, select, vi.fn());
    expect(select).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith(card.id);
  });

  it("reports a failed delete", async () => {
    const notify = vi.fn();
    api.remove.mockRejectedValueOnce(new Error("nope"));
    removeCard(card, () => false, vi.fn(), notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
  });
});
