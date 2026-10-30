// The desktop board's side of a Weft Worker (lib/worker-board.ts): the projects and cards read from the cloud
// rows, the commands sent back, and the run a new thread starts. The Supabase client is a fake; lib/workers-account.test.ts
// has the same shape.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardRow, fakeClient, workerRow } from "./worker-board.harness";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));

const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>();
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));

const { boardFrom, readWorkerBoard, workerPage, workerThreadPage, workerToolOutput } = await import("./worker-board");
const sync = await import("./cloud-sync");
const { OFFLINE_AFTER_MS } = await import("./workers-account");

const NOW = Date.parse("2026-10-29T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  syncOrgId.mockReset();
  syncOrgId.mockResolvedValue("org-1");
});

describe("readWorkerBoard", () => {
  it("is signed out with nothing on it when there's no session", async () => {
    const { client, calls } = fakeClient({ user: null });
    expect(await readWorkerBoard(client)).toEqual({ signedIn: false, projects: [], cards: [] });
    expect(calls).toEqual([]);
    expect(syncOrgId).not.toHaveBeenCalled();
  });

  it("is signed out with nothing on it when the user is in no workspace", async () => {
    syncOrgId.mockResolvedValue(null);
    const { client } = fakeClient();
    expect(await readWorkerBoard(client)).toEqual({ signedIn: false, projects: [], cards: [] });
  });

  it("is signed in with nothing on it when you have no workers", async () => {
    const { client } = fakeClient({ workers: [] });
    expect(await readWorkerBoard(client)).toEqual({ signedIn: true, projects: [], cards: [] });
  });

  it("reads your workers' projects and their cards", async () => {
    const { client, calls } = fakeClient({
      workers: [workerRow({ last_seen_at: new Date(NOW).toISOString() })],
      folderRows: [{ id: "w1", folders: ["ling"] }],
      cards: [cardRow()],
    });
    const board = await readWorkerBoard(client, NOW);
    expect(board.signedIn).toBe(true);
    expect(board.projects).toEqual([{ path: "worker://w1/ling", workerId: "w1", worker: "m1mini", folder: "ling", status: "online" }]);
    expect(board.cards).toHaveLength(1);
    expect(board.cards[0]!.cwd).toBe("worker://w1/ling");
    // Only your own workers, and never a desktop worker's.
    expect(calls).toContainEqual({ op: "eq", args: ["org_id", "org-1"] });
    expect(calls).toContainEqual({ op: "eq", args: ["owner_user", "u-1"] });
    expect(calls).toContainEqual({ op: "neq", args: ["kind", "desktop"] });
  });

  it("has no folders for a worker whose database hasn't got the column yet", async () => {
    const { client } = fakeClient({
      workers: [workerRow({ last_seen_at: new Date(NOW).toISOString() })],
      folderRows: [{ id: "w1", folders: null }],
      cards: [],
    });
    const board = await readWorkerBoard(client, NOW);
    expect(board.projects).toEqual([]);
    expect(board.cards).toEqual([]);
  });

  it("has no folders when the database has no rows for them at all", async () => {
    const { client } = fakeClient({
      workers: [workerRow({ last_seen_at: new Date(NOW).toISOString() })],
      folderRows: null,
      cards: [],
    });
    const board = await readWorkerBoard(client, NOW);
    expect(board.projects).toEqual([]);
    expect(board.cards).toEqual([]);
  });

  it("throws the database's error when the workers can't be read", async () => {
    const { client } = fakeClient({ workersError: { message: "boom" } });
    await expect(readWorkerBoard(client)).rejects.toThrow("Couldn't read your workers: boom");
  });

  it("throws the database's error when the cards can't be read", async () => {
    const { client } = fakeClient({ workers: [workerRow()], cardsError: { message: "boom" } });
    await expect(readWorkerBoard(client)).rejects.toThrow("Couldn't read your worker's threads: boom");
  });

  it("uses the account client by default", async () => {
    await expect(readWorkerBoard()).rejects.toThrow("no default client in tests");
  });
});

describe("boardFrom", () => {
  const workers = [workerRow({ id: "w1", name: "m1mini", last_seen_at: new Date(NOW).toISOString() })];

  it("is the union of the folders a worker reports and the folders its cards are in", () => {
    const out = boardFrom(workers, new Map([["w1", ["reported"]]]), [cardRow({ folder: "fromcard" })], NOW);
    expect(out.projects.map((p) => p.folder)).toEqual(["fromcard", "reported"]);
  });

  it("has no folder twice when a card is in a reported folder", () => {
    const out = boardFrom(workers, new Map([["w1", ["ling"]]]), [cardRow({ folder: "ling" })], NOW);
    expect(out.projects).toHaveLength(1);
  });

  it("leaves the copilot and a card with no folder out", () => {
    const out = boardFrom(workers, new Map([["w1", []]]), [cardRow({ card_id: "cop", card: { ...cardRow().card, id: "cop", role: "copilot" } }), cardRow({ card_id: "c2", folder: "" })], NOW);
    expect(out.cards).toEqual([]);
    expect(out.projects).toEqual([]);
  });

  it("files a card under its worker's project path", () => {
    const out = boardFrom(workers, new Map([["w1", ["ling"]]]), [cardRow()], NOW);
    expect(out.cards[0]).toMatchObject({ id: "c1", cwd: "worker://w1/ling" });
  });

  it("reads a worker that hasn't been seen lately as offline", () => {
    const stale = workerRow({ last_seen_at: new Date(NOW - OFFLINE_AFTER_MS - 1).toISOString() });
    const out = boardFrom([stale], new Map([["w1", ["ling"]]]), [], NOW);
    expect(out.projects[0]!.status).toBe("offline");
  });

  it("reads a worker that has never been seen as offline", () => {
    const out = boardFrom([workerRow({ last_seen_at: null })], new Map([["w1", ["ling"]]]), [], NOW);
    expect(out.projects[0]!.status).toBe("offline");
  });

  it("keeps a worker that was seen just now as it says", () => {
    const out = boardFrom([workerRow({ status: "busy", last_seen_at: new Date(NOW - 1000).toISOString() })], new Map([["w1", ["ling"]]]), [], NOW);
    expect(out.projects[0]!.status).toBe("busy");
  });

  it("has no folders for a worker that reported none", () => {
    const out = boardFrom(workers, new Map(), [], NOW);
    expect(out.projects).toEqual([]);
  });
});

describe("workerThreadPage", () => {
  it("reads a page of the thread's items", async () => {
    const { client, calls } = fakeClient({
      items: [
        { card_id: "c1", seq: 0, item: { kind: "user", text: "hi" } },
        { card_id: "c1", seq: 1, item: { kind: "assistant", text: "hello" } },
      ],
    });
    const page = await workerThreadPage("c1", undefined, client);
    expect(page).toEqual({ items: [{ kind: "user", text: "hi" }, { kind: "assistant", text: "hello" }], start: 0, total: 2 });
    expect(calls).toContainEqual({ op: "eq", args: ["card_id", "c1"] });
    expect(calls.some((c) => c.op === "lt")).toBe(false);
  });

  it("walks back with before", async () => {
    const { client, calls } = fakeClient({ items: [] });
    await workerThreadPage("c1", 5, client);
    expect(calls).toContainEqual({ op: "lt", args: ["seq", 5] });
  });

  it("has no page when the database can't be read", async () => {
    const { client } = fakeClient({ itemsError: { message: "boom" } });
    expect(await workerThreadPage("c1", undefined, client)).toBeNull();
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: null });
    await expect(workerThreadPage("c1", undefined, client)).rejects.toThrow("Sign in to Weft to reach your worker.");
  });

  it("uses the account client by default", async () => {
    await expect(workerThreadPage("c1", undefined)).rejects.toThrow("no default client in tests");
  });
});

describe("workerToolOutput", () => {
  it("reads the full result of a tool call", async () => {
    const { client } = fakeClient({ toolOutput: { result: "the whole thing" } });
    expect(await workerToolOutput("c1", "t1", client)).toBe("the whole thing");
  });

  it("says the output isn't there when it isn't", async () => {
    const { client } = fakeClient({ toolOutput: null });
    await expect(workerToolOutput("c1", "t1", client)).rejects.toThrow("That output isn't there.");
  });

  it("says the output isn't there when the database errors", async () => {
    const { client } = fakeClient({ toolError: { message: "boom" } });
    await expect(workerToolOutput("c1", "t1", client)).rejects.toThrow("That output isn't there.");
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: null });
    await expect(workerToolOutput("c1", "t1", client)).rejects.toThrow("Sign in to Weft to reach your worker.");
  });

  it("uses the account client by default", async () => {
    await expect(workerToolOutput("c1", "t1")).rejects.toThrow("no default client in tests");
  });
});

describe("workerPage", () => {
  const signedIn = (blob: Blob | null) => {
    const download = vi.fn(() => Promise.resolve(blob ? { data: blob, error: null } : { data: null, error: { message: "no" } }));
    const orgs = { select: () => orgs, eq: () => orgs, order: () => orgs, limit: () => orgs, maybeSingle: () => Promise.resolve({ data: { id: "org" } }), then: (ok: (v: unknown) => void) => ok({ data: [{ id: "org" }] }) };
    return {
      download,
      client: { auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u" } } } }) }, from: () => orgs, storage: { from: () => ({ download, createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) } } as never,
    };
  };

  it("serves a page's bytes under its stored type, and null when it can't read one", async () => {
    vi.spyOn(sync, "syncOrgId").mockResolvedValue("org");
    const { client, download } = signedIn(new Blob(["%PDF"], { type: "application/pdf" }));
    const got = await workerPage("a".repeat(64), client);
    expect(download).toHaveBeenCalledWith(`org/${"a".repeat(64)}`);
    expect(got?.type).toBe("application/pdf");
    expect(await workerPage("a".repeat(64), signedIn(null).client)).toBeNull();
  });

  it("reads an HTML page as text, and falls back when the store names no type", async () => {
    vi.spyOn(sync, "syncOrgId").mockResolvedValue("org");
    expect(await workerPage("a".repeat(64), signedIn(new Blob(["<!doctype html><p>hi"], { type: "text/plain" })).client)).toEqual({ type: "text/html; charset=utf-8", body: "<!doctype html><p>hi" });
    expect((await workerPage("a".repeat(64), signedIn(new Blob(["x"])).client))?.type).toBe("application/octet-stream");
  });
});
