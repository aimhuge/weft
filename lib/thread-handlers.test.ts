import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "./types";

const api = vi.hoisted(() => ({
  send: vi.fn(() => Promise.resolve()),
  answer: vi.fn(() => Promise.resolve()),
  release: vi.fn(() => Promise.resolve()),
  remove: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  setMode: vi.fn(() => Promise.resolve()),
  resetCopilot: vi.fn(() => Promise.resolve()),
}));
vi.mock("./client", () => ({ api }));
const { threadHandlers, useThreadHandlers } = await import("./thread-handlers");

const card: Card = {
  id: "c1", title: "t", prompt: "p", cwd: "/x", backend: "claude", permissionMode: "default",
  column: "review", lastLine: "", createdAt: 0, updatedAt: 0, pending: { id: "p1" } as Card["pending"],
};

const ctx = () => ({ select: vi.fn(), notify: vi.fn() });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.clearAllMocks());

describe("threadHandlers", () => {
  it("sends a message and lets a failed send reject to the reply box", async () => {
    const c = ctx();
    await threadHandlers(card, c).onSend("hello");
    expect(api.send).toHaveBeenCalledWith("c1", "hello");
    expect(c.select).not.toHaveBeenCalled();
    api.send.mockRejectedValueOnce(new Error("down"));
    await expect(threadHandlers(card, c).onSend("again")).rejects.toThrow("down");
  });

  it.each(["/done", "/weft:done", "/done-quick now", "  /done  "])("closes the thread as %j is sent, failures to notify", async (text) => {
    const c = ctx();
    api.send.mockRejectedValueOnce(new Error("busy"));
    await threadHandlers(card, c).onSend(text);
    await flush();
    expect(c.select).toHaveBeenCalledWith(null);
    expect(api.send).toHaveBeenCalledWith("c1", text);
    expect(c.notify).toHaveBeenCalledWith(new Error("busy"));
  });

  it("doesn't treat a word that only starts like /done as a wrap-up", async () => {
    const c = ctx();
    await threadHandlers(card, c).onSend("/doneness");
    expect(c.select).not.toHaveBeenCalled();
  });

  it("answers the pending request, notifying and rethrowing a failure so the form re-enables", async () => {
    const c = ctx();
    const reply = { notes: "n" } as never;
    await threadHandlers(card, c).onAnswer(true, { q: "a" }, reply);
    expect(api.answer).toHaveBeenCalledWith("c1", true, { q: "a" }, "p1", reply, undefined);
    api.answer.mockRejectedValueOnce(new Error("stale"));
    await expect(threadHandlers(card, c).onAnswer(false)).rejects.toThrow("stale");
    expect(c.notify).toHaveBeenCalledWith(new Error("stale"));
  });

  it("releases, renames and sets the mode through the api, failures to notify", async () => {
    const c = ctx();
    api.release.mockRejectedValueOnce(new Error("r"));
    const h = threadHandlers(card, c);
    h.onRelease();
    h.onRename("New name");
    h.onMode("acceptEdits");
    await flush();
    expect(api.release).toHaveBeenCalledWith("c1");
    expect(api.rename).toHaveBeenCalledWith("c1", "New name");
    expect(api.setMode).toHaveBeenCalledWith("c1", "acceptEdits");
    expect(c.notify).toHaveBeenCalledWith(new Error("r"));
  });

  it("deletes the card after closing it", async () => {
    const c = ctx();
    api.remove.mockRejectedValueOnce(new Error("gone"));
    threadHandlers(card, c).onDelete();
    await flush();
    expect(c.select).toHaveBeenCalledWith(null);
    expect(api.remove).toHaveBeenCalledWith("c1");
    expect(c.notify).toHaveBeenCalledWith(new Error("gone"));
  });

  it("starts a new copilot chat and reopens the card, failures to notify", async () => {
    const c = ctx();
    threadHandlers(card, c).onNewChat();
    await flush();
    expect(api.resetCopilot).toHaveBeenCalled();
    expect(c.select).toHaveBeenCalledWith("c1");
    api.resetCopilot.mockRejectedValueOnce(new Error("no"));
    threadHandlers(card, c).onNewChat();
    await flush();
    expect(c.notify).toHaveBeenCalledWith(new Error("no"));
  });

  it("closes the thread from its X and after the error banner's Delete", () => {
    const c = ctx();
    const h = threadHandlers(card, c);
    h.onClose();
    h.onDeleted();
    expect(c.select).toHaveBeenNthCalledWith(1, null);
    expect(c.select).toHaveBeenNthCalledWith(2, null);
  });
});

describe("useThreadHandlers", () => {
  it("gives no handlers with no card open, and the card's handlers with one", () => {
    const c = ctx();
    expect(useThreadHandlers(null, c)).toBeNull();
    useThreadHandlers(card, c)?.onClose();
    expect(c.select).toHaveBeenCalledWith(null);
  });
});
