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
    await vi.waitFor(() => expect(api.answer).toHaveBeenCalledWith("c1", true, undefined, "p1", undefined, undefined));
    api.stop.mockRejectedValueOnce(new Error("gone"));
    h.onStop();
    await vi.waitFor(() => expect(c.notify).toHaveBeenCalledWith(new Error("gone")));
  });

  it("answers with no pending id when the card has none", async () => {
    cardHandlers({ ...card, pending: undefined }, ctx()).onAnswer(false);
    await vi.waitFor(() => expect(api.answer).toHaveBeenCalledWith("c1", false, undefined, undefined, undefined, undefined));
  });

  it("signs an Allow on a phone-only ask after Touch ID before it sends, and sends nothing when Touch ID is refused", async () => {
    const sign = vi.fn(() => Promise.resolve({ device: "mac-1", issuedAt: 5, sig: "s", publicKey: "k" }));
    vi.stubGlobal("window", { weft: { approval: { sign } } });
    const risky = { ...card, pending: { id: "p1", toolName: "Bash", title: "", input: { command: "claude --dangerously-skip-permissions" } } };
    cardHandlers(risky, ctx()).onAnswer(true);
    await vi.waitFor(() => expect(api.answer).toHaveBeenCalledWith("c1", true, undefined, "p1", undefined, { device: "mac-1", issuedAt: 5, sig: "s" }));
    expect(sign).toHaveBeenCalledWith({ cardId: "c1", pendingId: "p1", allow: true });
    api.answer.mockClear();
    sign.mockResolvedValueOnce(null as never);
    const c = ctx();
    cardHandlers(risky, c).onAnswer(true);
    await vi.waitFor(() => expect(c.notify).toHaveBeenCalled());
    expect(api.answer).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
