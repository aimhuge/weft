import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const api = vi.hoisted(() => ({ answer: vi.fn(() => Promise.resolve()), stop: vi.fn(() => Promise.resolve()) }));
vi.mock("./client", () => ({ api }));
const { cardHandlers } = await import("./card-handlers");

const card: Card = {
  id: "c1", title: "t", prompt: "p", cwd: "/x", backend: "claude", permissionMode: "default",
  column: "done", lastLine: "", createdAt: 0, updatedAt: 0, pending: { id: "p1" } as Card["pending"],
};

const ctx = () => ({
  openCard: vi.fn(), resume: vi.fn(), move: vi.fn(), onCardMenu: vi.fn(), toggleStar: vi.fn(),
  toggleArchive: vi.fn(), onTag: vi.fn(), notify: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

describe("cardHandlers", () => {
  it("hands the card to the board's open, resume, menu, star, archive and tag actions", () => {
    const c = ctx();
    const h = cardHandlers(card, c);
    const e = {} as React.MouseEvent;
    h.onOpen();
    h.onResume("continue");
    h.onContextMenu(e);
    h.onStar();
    h.onArchive();
    h.onTag("bug");
    expect(c.openCard).toHaveBeenCalledWith(card);
    expect(c.resume).toHaveBeenCalledWith("c1", "continue");
    expect(c.onCardMenu).toHaveBeenCalledWith(card, e);
    expect(c.toggleStar).toHaveBeenCalledWith(card);
    expect(c.toggleArchive).toHaveBeenCalledWith(card);
    expect(c.onTag).toHaveBeenCalledWith("bug");
  });

  it("answers the pending request and stops through the api, failures to notify", async () => {
    const c = ctx();
    const h = cardHandlers(card, c);
    h.onAnswer(true);
    expect(api.answer).toHaveBeenCalledWith("c1", true, undefined, "p1");
    api.stop.mockRejectedValueOnce(new Error("gone"));
    h.onStop();
    await vi.waitFor(() => expect(c.notify).toHaveBeenCalledWith(new Error("gone")));
  });

  it("answers with no pending id when the card has none", () => {
    cardHandlers({ ...card, pending: undefined }, ctx()).onAnswer(false);
    expect(api.answer).toHaveBeenCalledWith("c1", false, undefined, undefined);
  });
});
