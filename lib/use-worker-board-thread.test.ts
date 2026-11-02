// @vitest-environment jsdom
// A worker card's thread on the desktop board (lib/use-worker-board.ts): opening it, and the actions its panel gets.
import type { Card } from "./types";
import type { WorkerProject } from "./worker-project";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendWorkerAction = vi.fn<(body: unknown) => Promise<{ commandId: string }>>();
vi.mock("./worker-transport", () => ({ sendWorkerAction: (body: unknown) => sendWorkerAction(body) }));
// A worker card's host (lib/project-host.ts): its verbs, as the handlers send them.
const hostAct = vi.fn<(verb: string, args: unknown) => Promise<void>>(() => Promise.resolve());
vi.mock("./project-host", () => ({ hostOf: () => ({ act: (verb: string, args: unknown) => hostAct(verb, args) }) }));

const { openWorkerThread, workerThreadHandlers } = await import("./use-worker-board");
const { forget } = await import("./optimistic-cards");

const project = (over: Record<string, unknown> = {}) => ({ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online", ...over }) as WorkerProject;

const card = (over: Record<string, unknown> = {}) => ({ id: "c1", title: "Fix it", prompt: "fix it", cwd: "worker://w1/ling", backend: "claude", permissionMode: "default", column: "review", createdAt: 0, updatedAt: 0, ...over }) as unknown as Card;

beforeEach(() => {
  vi.clearAllMocks();
  forget("c1");
});

describe("openWorkerThread", () => {
  const ctx = { select: vi.fn(), notify: vi.fn() };

  it("has nothing for a card that isn't a worker's", () => {
    expect(openWorkerThread({ projects: [project()], cards: [] }, "c1", ctx)).toBeNull();
    expect(openWorkerThread({ projects: [], cards: [] }, null, ctx)).toBeNull();
  });

  it("names the worker the card runs on", () => {
    const open = openWorkerThread({ projects: [project()], cards: [card()] }, "c1", ctx);
    expect(open?.worker).toEqual({ name: "m1mini", status: "online" });
    expect(open?.card.id).toBe("c1");
  });

  it("says the worker is offline when its project isn't known", () => {
    const open = openWorkerThread({ projects: [], cards: [card()] }, "c1", ctx);
    expect(open?.worker).toEqual({ name: "Your worker", status: "offline" });
  });

  it("says the worker is offline when its project says so", () => {
    const open = openWorkerThread({ projects: [project({ status: "offline" })], cards: [card()] }, "c1", ctx);
    expect(open?.worker.status).toBe("offline");
  });
});

describe("workerThreadHandlers", () => {
  const ctx = { select: vi.fn(), notify: vi.fn() };

  beforeEach(() => {
    sendWorkerAction.mockResolvedValue({ commandId: "cmd-1" });
  });

  it("sends a reply as a command", async () => {
    const handlers = workerThreadHandlers(card(), ctx);
    await handlers.onSend("hello");
    expect(sendWorkerAction).toHaveBeenCalledWith({ action: "reply", cardId: "c1", text: "hello" });
  });

  it("sends an answer as a command, with the pending id", async () => {
    const handlers = workerThreadHandlers(card({ pending: { id: "p1" } }), ctx);
    await handlers.onAnswer(true, { q: "a" });
    expect(sendWorkerAction).toHaveBeenCalledWith({ action: "answer", cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a" }, reply: undefined });
  });

  it("sends nothing when nothing is waiting for an answer", async () => {
    const handlers = workerThreadHandlers(card(), ctx);
    await expect(handlers.onAnswer(true)).resolves.toBeUndefined();
    expect(sendWorkerAction).not.toHaveBeenCalled();
  });

  it("says so when an answer fails, and throws it on", async () => {
    const boom = new Error("That thread isn't on one of your workers.");
    sendWorkerAction.mockRejectedValueOnce(boom);
    const handlers = workerThreadHandlers(card({ pending: { id: "p1" } }), ctx);
    await expect(handlers.onAnswer(false)).rejects.toThrow("That thread isn't on one of your workers.");
    expect(ctx.notify).toHaveBeenCalledWith(boom);
  });

  it("closes the thread", () => {
    const handlers = workerThreadHandlers(card(), ctx);
    handlers.onClose();
    expect(ctx.select).toHaveBeenCalledWith(null);
    ctx.select.mockClear();
    handlers.onDeleted();
    expect(ctx.select).toHaveBeenCalledWith(null);
  });

  it("deletes the card on its worker with card.delete, closing the thread at once", async () => {
    workerThreadHandlers(card(), ctx).onDelete();
    expect(ctx.select).toHaveBeenCalledWith(null);
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.delete", { id: "c1" });
  });

  it("says so when the worker refuses a delete", async () => {
    const boom = new Error("That thread isn't on this worker.");
    hostAct.mockRejectedValueOnce(boom);
    workerThreadHandlers(card(), ctx).onDelete();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.notify).toHaveBeenCalledWith(boom);
  });

  it("changes the mode on its worker with the menu's own verb, drawn at once", async () => {
    workerThreadHandlers(card(), ctx).onMode("acceptEdits");
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "c1", body: { permissionMode: "acceptEdits" } });
    expect(sendWorkerAction).not.toHaveBeenCalled();
  });

  it("renames the card on its worker", async () => {
    workerThreadHandlers(card(), ctx).onRename("A better name");
    await Promise.resolve();
    expect(hostAct).toHaveBeenCalledWith("card.update", { id: "c1", body: { title: "A better name" } });
  });

  it("says so when the worker refuses a rename", async () => {
    const boom = new Error("no");
    hostAct.mockRejectedValueOnce(boom);
    workerThreadHandlers(card(), ctx).onRename("A better name");
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.notify).toHaveBeenCalledWith(boom);
  });
});
