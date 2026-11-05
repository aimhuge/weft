import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardEvent, Card } from "./types";

// A vault grant for the thread (lib/vault-grant-done.ts) ends when its card's work ends: the card
// reaches Done, is archived or is deleted. Main is told to revoke the card's grants; the grant
// itself lives in main's memory (electron/vault-grants.cjs).

const shellMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ revoked: 1 })));
vi.mock("./browser-shell", () => ({ shell: shellMock }));

const { endGrantAtDone, workEnded } = await import("./vault-grant-done");
const { publish } = await import("./bus");
const { cardProof } = await import("./card-token");

// The card an event is about.
const card = (id: string, over: Partial<Card> = {}) => ({ id, title: `Card ${id}`, prompt: "", cwd: "/tmp", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over }) satisfies Card;

// A card that reached Done, was archived, or was deleted.
const done = (id: string): BoardEvent => ({ type: "card", card: card(id, { column: "done" }) });
const archived = (id: string): BoardEvent => ({ type: "card", card: card(id, { column: "review", archived: true }) });
const deleted = (id: string): BoardEvent => ({ type: "card_deleted", id });

// The module watches one card at a time and keeps the watch in a singleton that lives on
// globalThis, so each test here watches a card of its own.
let cardNo = 0;
const nextCard = () => `c${++cardNo}`;

beforeEach(() => shellMock.mockClear());

describe("workEnded", () => {
  it("is true when the card reaches Done, is archived, or is deleted", () => {
    expect(workEnded(done("c1"), "c1")).toBe(true);
    expect(workEnded(archived("c1"), "c1")).toBe(true);
    expect(workEnded(deleted("c1"), "c1")).toBe(true);
  });

  it("is false for another card", () => {
    expect(workEnded(done("c2"), "c1")).toBe(false);
    expect(workEnded(archived("c2"), "c1")).toBe(false);
    expect(workEnded(deleted("c2"), "c1")).toBe(false);
  });

  it("is false for a card that hasn't finished, and for other events", () => {
    expect(workEnded({ type: "card", card: card("c1", { column: "review" }) }, "c1")).toBe(false);
    expect(workEnded({ type: "thread", cardId: "c1", item: { kind: "user", text: "hi", at: 0 }, index: 0 }, "c1")).toBe(false);
    expect(workEnded({ type: "thread_cleared", cardId: "c1" }, "c1")).toBe(false);
    expect(workEnded({ type: "delta", cardId: "c1", text: "x" }, "c1")).toBe(false);
    expect(workEnded({ type: "login", login: { view: "signed_out" } as never }, "c1")).toBe(false);
    expect(workEnded({ type: "projects", projects: [] }, "c1")).toBe(false);
    expect(workEnded({ type: "account" }, "c1")).toBe(false);
    expect(workEnded({ type: "crons" }, "c1")).toBe(false);
    expect(workEnded({ type: "restart", restart: {} as never }, "c1")).toBe(false);
  });
});

describe("endGrantAtDone", () => {
  it("revokes the card's grants once it reaches Done", async () => {
    const id = nextCard();
    const revoke = vi.fn(() => Promise.resolve({ revoked: 1 }));
    endGrantAtDone(id, revoke);
    publish(done(id));
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith(id));
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("revokes the card's grants when it is archived, and when it is deleted", async () => {
    const one = nextCard();
    const archivedRevoke = vi.fn(() => Promise.resolve({ revoked: 1 }));
    endGrantAtDone(one, archivedRevoke);
    publish(archived(one));
    await vi.waitFor(() => expect(archivedRevoke).toHaveBeenCalledWith(one));

    const two = nextCard();
    const deletedRevoke = vi.fn(() => Promise.resolve({ revoked: 1 }));
    endGrantAtDone(two, deletedRevoke);
    publish(deleted(two));
    await vi.waitFor(() => expect(deletedRevoke).toHaveBeenCalledWith(two));
  });

  it("ignores another card's ending", async () => {
    const id = nextCard();
    const revoke = vi.fn(() => Promise.resolve({ revoked: 1 }));
    endGrantAtDone(id, revoke);
    publish(done("some-other-card"));
    publish(deleted("some-other-card"));
    publish(archived("some-other-card"));
    expect(revoke).not.toHaveBeenCalled();
    // The card's own ending still revokes: the watch is still open.
    publish(done(id));
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith(id));
  });

  it("watches nothing before the card ends", () => {
    const id = nextCard();
    const revoke = vi.fn(() => Promise.resolve({ revoked: 1 }));
    endGrantAtDone(id, revoke);
    publish({ type: "card", card: card(id, { column: "review" }) });
    publish({ type: "thread", cardId: id, item: { kind: "user", text: "hi", at: 0 }, index: 0 });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("is a no-op the second time for the same card", async () => {
    const id = nextCard();
    const revoke = vi.fn(() => Promise.resolve({ revoked: 1 }));
    endGrantAtDone(id, revoke);
    endGrantAtDone(id, revoke);
    publish(done(id));
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
  });

  it("watches no card when there is none", () => {
    const revoke = vi.fn(() => Promise.resolve({ revoked: 1 }));
    endGrantAtDone(undefined, revoke);
    endGrantAtDone("", revoke);
    publish(done(nextCard()));
    expect(revoke).not.toHaveBeenCalled();
  });

  it("swallows a refusal to revoke", async () => {
    const id = nextCard();
    // The refusal is caught: the module attaches a handler to the promise, so it never reaches
    // the board as an unhandled rejection.
    const refused = Promise.reject(new Error("main isn't there"));
    const caught = vi.spyOn(refused, "catch");
    const revoke = vi.fn(() => refused);
    endGrantAtDone(id, revoke);
    publish(done(id));
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith(id));
    expect(caught).toHaveBeenCalled();
    // The watch ends with the card either way: it doesn't retry.
    publish(done(id));
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  // Without a revoke of its own, it asks main to end the card's grants (electron/vault-routes.cjs).
  it("asks main to revoke the card's grants, with the card proven", async () => {
    const id = nextCard();
    endGrantAtDone(id);
    publish(done(id));
    await vi.waitFor(() => expect(shellMock).toHaveBeenCalledTimes(1));
    expect(shellMock).toHaveBeenCalledWith("/secrets/revoke-card", cardProof(id, "/secrets/revoke-card"));
  });
});
