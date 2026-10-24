// Route-level tests for the switch-backend endpoints. Kept in a separate file because
// app/api/routes.test.ts is already at its ratchet size and the mid-refactor state has
// missing types elsewhere. Mirrors the in-memory store + mocked runner + mocked settings
// pattern from routes.test.ts so the test stands on its own.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/types";

const db = vi.hoisted(() => ({ cards: new Map<string, Card>(), threads: new Map<string, unknown[]>(), seq: 0 }));
const busyIds = new Set<string>();

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/store", () => ({
  DATA_DIR: "/tmp/weft-api-test-data",
  listCards: vi.fn(() => [...db.cards.values()]),
  getCard: vi.fn((id: string) => db.cards.get(id)),
  createCard: vi.fn(() => {
    throw new Error("not used");
  }),
  updateCard: vi.fn((id: string, patch: Partial<Card>) => {
    const card = db.cards.get(id);
    if (!card) throw new Error(`No card ${id}`);
    Object.assign(card, patch);
    return card;
  }),
  deleteCard: vi.fn(),
  getThread: vi.fn((id: string) => db.threads.get(id) ?? []),
}));

vi.mock("@/lib/runner", () => ({
  isBusy: vi.fn((id: string) => busyIds.has(id)),
  switchBackend: vi.fn((id: string, backend: Card["backend"]) => {
    const card = db.cards.get(id);
    if (!card) return Promise.reject(new Error("No such card."));
    if (card.backend === backend) return Promise.resolve();
    if (busyIds.has(id)) return Promise.reject(new Error("Stop the thread before switching its CLI."));
    Object.assign(card, { backend, sessionId: undefined, rateLimitHit: false });
    return Promise.resolve();
  }),
}));

vi.mock("@/lib/settings", () => ({
  setDefaultBackend: vi.fn(),
  defaultBackend: vi.fn(() => "claude"),
  setThreadPrompt: vi.fn(),
  setKeepAliveMinutes: vi.fn(),
  setDefaultPermissionMode: vi.fn(),
  setAutomations: vi.fn(),
  settingsView: vi.fn(() => ({
    threadPrompt: "tp",
    defaultThreadPrompt: "",
    keepAliveMinutes: 5,
    defaultPermissionMode: "auto",
    defaultBackend: "claude",
    automations: [],
    projects: [],
  })),
}));

const runner = await import("@/lib/runner");
const settingsRoute = await import("./settings/route");
const settings = await import("@/lib/settings");
const batchRoute = await import("./cards/switch-backend/route");
const cardRoute = await import("./cards/[id]/switch-backend/route");

const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

function req(url: string, { method = "GET", body, headers = WRITE }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`http://localhost:3457/api${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function addCard(patch: Partial<Card> = {}): Card {
  const card: Card = {
    id: `card-${++db.seq}`,
    title: "T",
    prompt: "do it",
    cwd: "/tmp",
    backend: "claude",
    permissionMode: "auto",
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
  db.threads.clear();
  busyIds.clear();
  vi.clearAllMocks();
  vi.mocked(runner.switchBackend).mockImplementation((id, backend) => {
    const card = db.cards.get(id);
    if (!card) return Promise.reject(new Error("No such card."));
    if (card.backend === backend) return Promise.resolve();
    if (busyIds.has(id)) return Promise.reject(new Error("Stop the thread before switching its CLI."));
    Object.assign(card, { backend, sessionId: undefined, rateLimitHit: false });
    return Promise.resolve();
  });
  vi.mocked(runner.isBusy).mockImplementation((id) => busyIds.has(id));
});

describe("/api/settings — defaultBackend", () => {
  const patch = (body: unknown) => settingsRoute.PATCH(req("/settings", { method: "PATCH", body }));

  it("PATCH { defaultBackend: 'puku' } saves it; the next PATCH + GET return puku", async () => {
    const viewWithPuku = {
      threadPrompt: "tp",
      defaultThreadPrompt: "",
      keepAliveMinutes: 5,
      defaultPermissionMode: "auto",
      defaultBackend: "puku",
      automations: [],
      projects: [],
    };
    vi.mocked(settings.settingsView)
      .mockReturnValueOnce(viewWithPuku as never)
      .mockReturnValueOnce(viewWithPuku as never);
    const res = await patch({ defaultBackend: "puku" });
    expect(res.status).toBe(200);
    expect(settings.setDefaultBackend).toHaveBeenCalledWith("puku");
    const getRes = await settingsRoute.GET(req("/settings"));
    const after = (await getRes.json()) as { defaultBackend: string };
    expect(after.defaultBackend).toBe("puku");
  });

  it("PATCH { defaultBackend: 'bogus' } 400s and saves nothing", async () => {
    const res = await patch({ defaultBackend: "bogus" });
    expect(res.status).toBe(400);
    expect(settings.setDefaultBackend).not.toHaveBeenCalled();
  });

  it("PATCH without defaultBackend does not change it", async () => {
    const res = await patch({ threadPrompt: "hello" });
    expect(res.status).toBe(200);
    expect(settings.setDefaultBackend).not.toHaveBeenCalled();
  });
});

describe("POST /api/cards/switch-backend (batch)", () => {
  const post = (body: unknown) => batchRoute.POST(req("/cards/switch-backend", { method: "POST", body }));

  it("switches each card; rateLimitHit cards replay the last user message; busy cards are returned in pending", async () => {
    const idle = addCard({ backend: "claude", column: "backlog" });
    const rateLimited = addCard({ backend: "claude", column: "needs_you", rateLimitHit: true });
    db.threads.set(rateLimited.id, [{ kind: "user", text: "retry me", at: 1 }]);
    const busy = addCard({ backend: "claude", column: "running" });
    busyIds.add(busy.id);

    const res = await post({ ids: [idle.id, rateLimited.id, busy.id], backend: "puku" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { switched: string[]; failed: { id: string; error: string }[]; pending: string[] };
    expect(json.switched).toEqual([idle.id, rateLimited.id]);
    expect(json.failed).toEqual([]);
    expect(json.pending).toEqual([busy.id]);

    expect(runner.switchBackend).toHaveBeenCalledWith(idle.id, "puku", { replay: false });
    expect(runner.switchBackend).toHaveBeenCalledWith(rateLimited.id, "puku", { replay: true });
    expect(runner.switchBackend).not.toHaveBeenCalledWith(busy.id, expect.anything(), expect.anything());
  });

  it("rejects missing/empty ids, a bad backend, and bad JSON", async () => {
    addCard();
    for (const payload of [{}, { ids: [] }, { ids: "nope" }, { ids: ["a"], backend: "bogus" }, { ids: ["a"] }, "{"]) {
      expect((await post(payload)).status, JSON.stringify(payload)).toBe(400);
    }
    expect(runner.switchBackend).not.toHaveBeenCalled();
  });

  it("a missing card ends up in failed, not the error path", async () => {
    const res = await post({ ids: ["ghost"], backend: "puku" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { switched: string[]; failed: { id: string; error: string }[] };
    expect(json.failed).toEqual([{ id: "ghost", error: "no such card" }]);
    expect(runner.switchBackend).not.toHaveBeenCalled();
  });
});

describe("POST /api/cards/:id/switch-backend", () => {
  const post = (id: string, body: unknown) => cardRoute.POST(req(`/cards/${id}/switch-backend`, { method: "POST", body }), ctx(id));

  it("switches the card and replays the last user message when asked", async () => {
    const card = addCard({ backend: "claude", column: "needs_you", rateLimitHit: true });
    db.threads.set(card.id, [{ kind: "user", text: "do the thing", at: 1 }]);
    const res = await post(card.id, { backend: "puku", replay: true });
    expect(res.status).toBe(200);
    expect(runner.switchBackend).toHaveBeenCalledWith(card.id, "puku", { replay: true });
    const json = (await res.json()) as { card: { id: string; backend: string } };
    expect(json.card.id).toBe(card.id);
    expect(json.card.backend).toBe("puku");
  });

  it("switches without replay when replay is omitted or false", async () => {
    const card = addCard({ backend: "claude" });
    for (const payload of [{ backend: "puku" }, { backend: "puku", replay: false }]) {
      await post(card.id, payload);
      expect(runner.switchBackend).toHaveBeenLastCalledWith(card.id, "puku", { replay: false });
    }
  });

  it("passes a model of that CLI along, and 400s one from the other CLI", async () => {
    const card = addCard({ backend: "claude" });
    await post(card.id, { backend: "puku", model: "puku-ai-2.7" });
    expect(runner.switchBackend).toHaveBeenLastCalledWith(card.id, "puku", { replay: false, model: "puku-ai-2.7" });
    const res = await post(card.id, { backend: "puku", model: "claude-fable-5-1" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/isn't a puku model/);
  });

  it("takes the no-model choice (the Default model row) as a blank model", async () => {
    // "" is "let the CLI decide" — not a model id, so it isn't refused.
    const card = addCard({ backend: "claude" });
    const res = await post(card.id, { backend: "claude", model: "" });
    expect(res.status).toBe(200);
    expect(runner.switchBackend).toHaveBeenLastCalledWith(card.id, "claude", { replay: false, model: "" });
  });

  it("404s an unknown card; 400s a bad backend or bad JSON", async () => {
    addCard();
    expect((await post("ghost", { backend: "puku" })).status).toBe(404);
    expect((await post("ghost", "{")).status).toBe(404);
    const card = addCard();
    for (const payload of [{ backend: "bogus" }, { backend: 5 }, {}, "{"]) {
      expect((await post(card.id, payload)).status, JSON.stringify(payload)).toBe(400);
    }
    expect(runner.switchBackend).not.toHaveBeenCalled();
  });
});