// A board card's controls on whichever host runs it (lib/card-handlers-host.ts): this Mac's keep cardHandlers, a
// worker's send the same actions as host verbs, each drawn at once through lib/optimistic-cards.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardActionsCtx } from "./card-handlers";
import type { Card } from "./types";

const act = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()));
const kind = vi.hoisted((): { value: "local" | "cloud" } => ({ value: "cloud" }));
vi.mock("./project-host", () => ({ hostOf: () => ({ kind: kind.value, act }) }));

// Each optimistic helper runs the call it's given, and says what it drew.
const drawn = vi.hoisted(() => vi.fn());
vi.mock("./optimistic-cards", () => {
  const run = (name: string) => (...args: unknown[]) => {
    drawn(name, ...args.slice(0, -1));
    return (args.at(-1) as () => Promise<unknown>)().then(() => {});
  };
  return { answerNow: run("answer"), stopNow: run("stop"), patchNow: run("patch"), waitNow: run("wait"), firstNow: run("first"), otherFirstNow: run("otherFirst") };
});

const local = vi.hoisted(() => vi.fn(() => ({ local: true })));
vi.mock("./card-handlers", () => ({ cardHandlers: local }));

const { handlersFor, holdNow, remoteCardHandlers } = await import("./card-handlers-host");

const card = (over: Partial<Card> = {}) => ({ id: "c1", title: "Fix it", cwd: "worker://w1/ling", column: "review", ...over }) as Card;

function ctx(): CardActionsCtx {
  return { openCard: vi.fn(), resume: vi.fn(), move: vi.fn(), onCardMenu: vi.fn(), toggleStar: vi.fn(), toggleArchive: vi.fn(), onTag: vi.fn(), notify: vi.fn() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  kind.value = "cloud";
});

describe("handlersFor", () => {
  it("gives this Mac's card its own handlers", () => {
    kind.value = "local";
    const c = ctx();
    expect(handlersFor(card(), c)).toEqual({ local: true });
    expect(local).toHaveBeenCalledWith(card(), c);
  });

  it("gives a worker's card its host's", () => {
    expect(handlersFor(card(), ctx())).not.toEqual({ local: true });
    expect(local).not.toHaveBeenCalled();
  });
});

describe("remoteCardHandlers", () => {
  it("opens, stars, archives, tags and shows the menu through the board", () => {
    const c = ctx();
    const h = remoteCardHandlers(card(), c);
    h.onOpen();
    h.onStar();
    h.onArchive();
    h.onTag("ui");
    const e = {} as React.MouseEvent;
    h.onContextMenu(e);
    expect(c.openCard).toHaveBeenCalledWith(card());
    expect(c.toggleStar).toHaveBeenCalledWith(card());
    expect(c.toggleArchive).toHaveBeenCalledWith(card());
    expect(c.onTag).toHaveBeenCalledWith("ui");
    expect(c.onCardMenu).toHaveBeenCalledWith(card(), e);
  });

  it("answers a prompt as a host verb, drawn at once", async () => {
    remoteCardHandlers(card({ pending: { id: "p1" } as Card["pending"] }), ctx()).onAnswer(true);
    await flush();
    expect(drawn).toHaveBeenCalledWith("answer", "c1", "p1", true);
    expect(act).toHaveBeenCalledWith("card.permission.answer", { id: "c1", allow: true, pendingId: "p1" });
  });

  it("answers nothing when nothing waits", () => {
    remoteCardHandlers(card(), ctx()).onAnswer(true);
    expect(act).not.toHaveBeenCalled();
  });

  it("stops the turn on the worker", async () => {
    remoteCardHandlers(card({ column: "running" }), ctx()).onStop();
    await flush();
    expect(drawn).toHaveBeenCalledWith("stop", "c1");
    expect(act).toHaveBeenCalledWith("card.stop", { id: "c1" });
  });

  it("continues with a message, or restarts, moving the card to Running at once", async () => {
    const h = remoteCardHandlers(card(), ctx());
    h.onResume("continue");
    h.onResume("restart");
    await flush();
    expect(drawn).toHaveBeenCalledWith("patch", "c1", { column: "running" });
    expect(act).toHaveBeenCalledWith("card.message", { id: "c1", text: "continue" });
    expect(act).toHaveBeenCalledWith("card.restart", { id: "c1" });
  });

  it("tells the board when the worker refuses", async () => {
    const boom = new Error("That thread isn't on this worker.");
    act.mockRejectedValueOnce(boom);
    const c = ctx();
    remoteCardHandlers(card({ column: "running" }), c).onStop();
    await flush();
    expect(c.notify).toHaveBeenCalledWith(boom);
  });
});

describe("holdNow", () => {
  it.each([
    ["wait", "card.permission.wait"],
    ["first", "card.permission.first"],
    ["otherFirst", "card.permission.otherFirst"],
  ] as const)("%s asks the card's host with %s", async (hold, verb) => {
    await holdNow(card(), hold, "p1");
    expect(drawn).toHaveBeenCalledWith(hold, "c1", "p1");
    expect(act).toHaveBeenCalledWith(verb, { id: "c1", pendingId: "p1" });
  });
});
