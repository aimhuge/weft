// The PATCH/DELETE handlers of one card, on their own: the store is an in-memory Map, and everything
// that starts a CLI, spawns a process or reads ~/.weft is mocked. app/api/routes.test.ts covers the
// same route's ordinary moves; this file covers the marks, the read grant, the reorder and the
// deletions that need a shell token or a worktree pool.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), seq: 0, token: "" }));

vi.mock("next/server", () => ({ connection: async () => {} }));

// The launch token exists only in the desktop app. With one, elevated() can refuse a request that
// carries the plain "1" a thread's curl sends.
vi.mock("@/lib/shell-token", () => ({ shellToken: () => db.token }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-card-route-test-data",
  getCard: vi.fn((id: string) => db.cards.get(id)),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = db.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  }),
  deleteCard: vi.fn((id: string) => db.cards.delete(id)),
  reorderCard: vi.fn((id: string, beforeId: string | null) => {
    const card = db.cards.get(id);
    // The real store puts the card's place in its column in `order` (lib/store.ts reorderCard).
    if (card) card.order = beforeId === null ? undefined : db.cards.get(beforeId)?.order;
    return card;
  }),
}));

vi.mock("@/lib/runner", () => ({
  sendMessage: vi.fn(),
  queueMessages: vi.fn(),
  archiveWhenIdle: vi.fn(),
  endSession: vi.fn(() => Promise.resolve()),
  isBusy: vi.fn(() => false),
  setPermissionMode: vi.fn((id: string, permissionMode: Card["permissionMode"]) => Object.assign(db.cards.get(id)!, { permissionMode })),
}));

vi.mock("@/lib/settings", () => ({ dismissSession: vi.fn() }));

vi.mock("@/lib/automations", () => ({
  firstMessage: vi.fn((card: Card) => `first:${card.prompt}`),
  messagesForMove: vi.fn((_card: Card, column: string) => [`/move-${column}`]),
  doneOverrides: vi.fn(() => ({})),
}));

vi.mock("@/lib/tag-store", () => ({ rememberTags: vi.fn() }));

vi.mock("@/lib/worktree-pool", () => ({ dropWorktree: vi.fn(() => Promise.resolve()) }));

const runner = await import("@/lib/runner");
const store = await import("@/lib/store");
const automations = await import("@/lib/automations");
const tagStore = await import("@/lib/tag-store");
const worktrees = await import("@/lib/worktree-pool");
const route = await import("./route");

/** The fields of a route's JSON reply these tests read. */
type Body = { card: Card; error: string; ok: boolean };
const body = async (res: Response) => (await res.json()) as Body;

// The plain "1" a board window sends; a launch token makes some changes Weft's own window only.
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) => route.PATCH(req(`/cards/${id}`, { method: "PATCH", body }), ctx(id));
const del = (id: string) => route.DELETE(req(`/cards/${id}`, { method: "DELETE" }), ctx(id));

function addCard(patch: Partial<Card> = {}): Card {
  const card: Card = {
    id: `card-${++db.seq}`,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "default",
    column: "backlog",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
  db.cards.set(card.id, card);
  return card;
}

beforeEach(() => {
  db.cards.clear();
  db.seq = 0;
  db.token = "";
  vi.clearAllMocks();
});

describe("the marks on a card", () => {
  it("stars and unstars a card", async () => {
    const card = addCard();
    await patch(card.id, { starred: true });
    expect(db.cards.get(card.id)!.starred).toBe(true);
    await patch(card.id, { starred: false });
    expect(db.cards.get(card.id)!.starred).toBe(false);
  });

  it("dismisses the card's 'Broke Weft' mark", async () => {
    const card = addCard({ broke: { kind: "server", at: 1, why: "thread died" } });
    await patch(card.id, { broke: null });
    expect(db.cards.get(card.id)!.broke).toBeUndefined();
  });

  it("keeps the tags you set as yours, and adds the new ones to the catalog", async () => {
    const card = addCard();
    await patch(card.id, { tags: ["#UI", " Bug "] });
    expect(db.cards.get(card.id)).toMatchObject({ tags: ["ui", "bug"], tagsBy: "user" });
    expect(tagStore.rememberTags).toHaveBeenLastCalledWith(["ui", "bug"]);
  });

  it("refuses tags that aren't a list", async () => {
    const card = addCard();
    const res = await patch(card.id, { tags: "ui" });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("Tags must be a list.");
    expect(store.updateCard).not.toHaveBeenCalled();
  });
});

describe("the permission mode of a card", () => {
  it("keeps a Codex session's sandbox for the life of the session", async () => {
    const card = addCard({ backend: "codex", sessionId: "s1", permissionMode: "default" });
    const res = await patch(card.id, { permissionMode: "acceptEdits" });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toMatch(/Codex keeps its sandbox mode/);
    expect(runner.setPermissionMode).not.toHaveBeenCalled();
  });

  it("lets a fresh Codex thread pick its sandbox", async () => {
    const card = addCard({ backend: "codex", permissionMode: "default" });
    expect((await patch(card.id, { permissionMode: "acceptEdits" })).status).toBe(200);
    expect(runner.setPermissionMode).toHaveBeenCalledWith(card.id, "acceptEdits");
  });
});

describe("the read scope of a card", () => {
  it("adds the folder you picked to the card's read scope", async () => {
    const card = addCard({ cwd: "/tmp" });
    await patch(card.id, { readScope: "/elsewhere" });
    expect(db.cards.get(card.id)!.readScope).toEqual(["/elsewhere"]);
  });

  it("refuses a read scope that isn't a path", async () => {
    const card = addCard();
    const res = await patch(card.id, { readScope: "" });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("readScope must be a non-empty path.");
    const notAString = await patch(card.id, { readScope: 42 });
    expect(notAString.status).toBe(400);
  });

  it("refuses a read scope for the copilot", async () => {
    const cop = addCard({ role: "copilot" });
    const res = await patch(cop.id, { readScope: "/elsewhere" });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("The copilot doesn't read from project folders.");
  });

  it("needs Weft's own window when the desktop app has a launch token", async () => {
    db.token = "launch-token";
    const card = addCard();
    const res = await patch(card.id, { readScope: "/elsewhere" });
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("This change needs Weft's own window");
    expect(store.updateCard).not.toHaveBeenCalled();
  });

  it("lets Weft's own window make the change when the token is on the request", async () => {
    db.token = "launch-token";
    const card = addCard();
    const res = await route.PATCH(
      req(`/cards/${card.id}`, { method: "PATCH", body: { readScope: "/elsewhere" }, headers: { ...WRITE, "x-weft-token": "launch-token" } }),
      ctx(card.id),
    );
    expect(res.status).toBe(200);
    expect(db.cards.get(card.id)!.readScope).toEqual(["/elsewhere"]);
  });
});

describe("reordering a card in its column", () => {
  it("puts the card before its sibling, or at the end", async () => {
    const card = addCard();
    await patch(card.id, { before: "card-9" });
    expect(store.reorderCard).toHaveBeenLastCalledWith(card.id, "card-9");
    await patch(card.id, { before: null });
    expect(store.reorderCard).toHaveBeenLastCalledWith(card.id, null);
  });

  it("refuses a before that isn't a card id", async () => {
    const card = addCard();
    const res = await patch(card.id, { before: 7 });
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("before must be a card id or null.");
    expect(store.reorderCard).not.toHaveBeenCalled();
  });
});

describe("moving a card to Done", () => {
  it("hands the wrap-up to another CLI when Settings chose one", async () => {
    vi.mocked(automations.doneOverrides).mockReturnValueOnce({ backend: "puku" });
    const card = addCard({ column: "review", backend: "claude", sessionId: "s1" });
    await patch(card.id, { column: "done" });
    const after = db.cards.get(card.id)!;
    expect(after.backend).toBe("puku");
    expect(after.preDoneBackend).toBe("claude");
    expect(after.sessionId).toBeUndefined();
  });

  it("moves the model and the effort over when there are no other overrides", async () => {
    vi.mocked(automations.doneOverrides).mockReturnValueOnce({ model: "claude-opus-5-5" });
    const card = addCard({ column: "review", model: "claude-sonnet-5-5" });
    await patch(card.id, { column: "done" });
    const after = db.cards.get(card.id)!;
    expect(after.model).toBe("claude-opus-5-5");
    expect(after.preDoneBackend).toBeUndefined();
  });
});

describe("deleting a card", () => {
  it("drops the worktree of an isolated card", async () => {
    const card = addCard({ worktree: { repo: "/repo", path: "/wt/path", branch: "wt/x", base: "main" } });
    const res = await del(card.id);
    expect(res.status).toBe(200);
    expect(worktrees.dropWorktree).toHaveBeenCalledWith(card.worktree);
  });

  it("keeps going when the worktree can't be dropped", async () => {
    vi.mocked(worktrees.dropWorktree).mockRejectedValueOnce(new Error("already gone"));
    const card = addCard({ worktree: { repo: "/repo", path: "/wt/path", branch: "wt/x", base: "main" } });
    const res = await del(card.id);
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true });
  });

  it("answers 400 when the card can't be deleted", async () => {
    const card = addCard();
    vi.mocked(runner.endSession).mockRejectedValueOnce(new Error("the CLI won't stop"));
    const res = await del(card.id);
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("the CLI won't stop");
  });
});
