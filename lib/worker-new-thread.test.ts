// A new thread in a worker project (lib/worker-new-thread.ts): a card.create host command in the project's folder,
// under an id picked here, with the fields the New thread dialog chose. The Supabase client is a fake.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, workerRow } from "./worker-board.harness";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
// This Mac knows no project by the worker's folder name unless a test says so.
vi.mock("./worker-folder-repo", () => ({ START_CONNECTOR: {}, connectorStart: (_o: unknown, deps: { repoOf?: (f: string) => string | null }) => Promise.resolve(deps.repoOf ? { repo: deps.repoOf("ling") } : {}) }));

const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>();
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));

const { startWorkerThread, createArgs } = await import("./worker-new-thread");
const { ABSENT_OFFLINE_AFTER_MS, SLOW_OFFLINE_AFTER_MS } = await import("./worker-presence");

const NOW = Date.parse("2026-10-29T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  syncOrgId.mockReset();
  syncOrgId.mockResolvedValue("org-1");
});

describe("startWorkerThread", () => {
  const online = workerRow({ last_seen_at: new Date(NOW).toISOString() });

  it("builds a card.create for the worker, in the project's folder, under the id it answers with", async () => {
    const { client, inserted } = fakeClient({ workers: [online], insertId: "cmd-3" });
    const got = await startWorkerThread({ cwd: "worker://w1/ling", prompt: " Add dark mode " }, client, NOW);
    expect(got).toMatchObject({ commandId: "cmd-3", worker: "m1mini" });
    expect(got.cardId).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted()).toEqual({
      org_id: "org-1",
      kind: "host",
      target_device: "worker:w1",
      folder: "ling",
      payload: { verb: "card.create", args: { id: got.cardId, prompt: "Add dark mode", start: true } },
    });
  });

  it("seals a pasted file with the worker's newest grant: there's no card row yet to take a version from", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "new-thread-paste-")), "attachments");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "shot-1a2b.png"), "a screenshot");
    for (const agent of [undefined, "reviewer"]) {
      const { client, calls, uploads } = fakeClient({ workers: [online], grants: [] });
      await startWorkerThread({ cwd: "worker://w1/ling", prompt: `look ![s](${path.join(dir, "shot-1a2b.png")})`, agent }, client, NOW, dir);
      // No grant: the file goes up plain, as the worker publishes.
      expect(calls).toContainEqual({ op: "from", args: ["worker_key_grants"] });
      expect(calls).toContainEqual({ op: "eq", args: ["worker_id", "w1"] });
      expect(String(uploads[0]?.body)).toBe("a screenshot");
    }
  });

  it("names the repo this Mac knows the folder as, for the GitHub connector", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    const repoOf = vi.fn(() => "ada/ling");
    await startWorkerThread({ cwd: "worker://w1/ling", prompt: "go" }, client, NOW, undefined, undefined, { repoOf, sign: vi.fn() });
    expect(repoOf).not.toHaveBeenCalled();
    await startWorkerThread({ cwd: "worker://w1/ling", prompt: "go", signStart: true }, client, NOW, undefined, undefined, { repoOf, sign: vi.fn() });
    expect(repoOf).toHaveBeenCalledWith("ling");
    expect(inserted()).toMatchObject({ kind: "host", payload: { verb: "card.create", repo: "ada/ling" } });
  });

  it("carries the title, CLI, model, effort, mode, tags and isolation, and start: false for Backlog", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    const body = { cwd: "worker://w1/ling", prompt: "go", title: "Dark mode", backend: "codex", model: "gpt-5", effort: "high", permissionMode: "plan", tags: ["ui"], isolated: true, branch: "feat/x", start: false };
    await startWorkerThread(body, client, NOW);
    expect(inserted()).toMatchObject({
      payload: { verb: "card.create", args: { prompt: "go", title: "Dark mode", backend: "codex", model: "gpt-5", effort: "high", permissionMode: "plan", tags: ["ui"], isolated: true, branch: "feat/x", start: false } },
    });
  });

  it("sends a thread with an agent as a run carrying its signed approval, for the worker to check", async () => {
    const { client, inserted } = fakeClient({ workers: [online], insertId: "cmd-4" });
    const body = { cwd: "worker://w1/ling", prompt: " go ", title: "T", backend: "codex", effort: "high", agent: "builder", widen: { kind: "ed25519" }, start: true };
    expect(await startWorkerThread(body, client, NOW)).toEqual({ commandId: "cmd-4", worker: "m1mini", cardId: "" });
    expect(inserted()).toEqual({
      org_id: "org-1",
      kind: "run",
      target_device: "worker:w1",
      folder: "ling",
      payload: { prompt: "go", title: "T", backend: "codex", effort: "high", agent: "builder", widen: { kind: "ed25519" } },
    });
  });

  it("refuses a thread with an agent for the Backlog, and inserts nothing", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    await expect(startWorkerThread({ cwd: "worker://w1/ling", prompt: "go", agent: "builder", start: false }, client, NOW)).rejects.toThrow("starts right away");
    expect(inserted()).toBeNull();
  });

  it("leaves out what wasn't given", () => {
    expect(createArgs({ cwd: "x", prompt: "p", model: "", effort: undefined })).toEqual({ prompt: "p", start: true });
  });

  it("never asks for a thread that runs without asking", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    await startWorkerThread({ cwd: "worker://w1/ling", prompt: "go", permissionMode: "bypassPermissions" }, client, NOW);
    const row = inserted() as { payload: { args: Record<string, unknown> } };
    expect(row.payload.args.permissionMode).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("bypassPermissions");
  });

  it("refuses a path that isn't a worker project", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    await expect(startWorkerThread({ cwd: "/dev/app", prompt: "go" }, client, NOW)).rejects.toThrow("That isn't a worker project.");
    expect(inserted()).toBeNull();
  });

  it("refuses a worker that isn't yours, and inserts nothing", async () => {
    const { client, inserted } = fakeClient({ workers: [workerRow({ id: "w2", owner_user: "u-2" })] });
    await expect(startWorkerThread({ cwd: "worker://w1/ling", prompt: "go" }, client, NOW)).rejects.toThrow("That worker isn't one of yours anymore.");
    expect(inserted()).toBeNull();
  });

  it("asks presence whether the worker is up", async () => {
    const quiet = workerRow({ last_seen_at: new Date(NOW - ABSENT_OFFLINE_AFTER_MS - 1).toISOString() });
    const gone = { read: vi.fn(() => Promise.resolve({ known: new Set(["w1"]), present: new Map() })) };
    await expect(startWorkerThread({ cwd: "worker://w1/ling", prompt: "go" }, fakeClient({ workers: [quiet] }).client, NOW, undefined, gone)).rejects.toThrow("m1mini is offline");
    expect(gone.read).toHaveBeenCalledWith(expect.any(Function), ["w1"], { owner: "u-1" });
    const up = { read: () => Promise.resolve({ known: new Set(["w1"]), present: new Map([["w1", "online" as const]]) }) };
    const { client, inserted } = fakeClient({ workers: [quiet] });
    await startWorkerThread({ cwd: "worker://w1/ling", prompt: "go" }, client, NOW, undefined, up);
    expect(inserted()).not.toBeNull();
  });

  it("refuses an offline worker, and inserts nothing", async () => {
    const { client, inserted } = fakeClient({ workers: [workerRow({ last_seen_at: new Date(NOW - SLOW_OFFLINE_AFTER_MS - 1).toISOString() })] });
    await expect(startWorkerThread({ cwd: "worker://w1/ling", prompt: "go" }, client, NOW)).rejects.toThrow("m1mini is offline, so this didn't start. Nothing ran on this Mac; try again once it's back.");
    expect(inserted()).toBeNull();
  });

  it("refuses a run with no prompt", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    await expect(startWorkerThread({ cwd: "worker://w1/ling", prompt: "  " }, client, NOW)).rejects.toThrow("Write a prompt for this thread.");
    expect(inserted()).toBeNull();
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: null });
    await expect(startWorkerThread({ cwd: "worker://w1/ling", prompt: "go" }, client, NOW)).rejects.toThrow("Sign in to Weft to reach your worker.");
  });

  it("uses the account client by default", async () => {
    await expect(startWorkerThread({ cwd: "worker://w1/ling", prompt: "go" })).rejects.toThrow("no default client in tests");
  });
});
