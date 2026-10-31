// The commands the desktop sends to a worker (lib/worker-board.ts): a reply, an answer and a stop go out as
// the same cloud_commands rows the web board sends, and a new thread goes out as a run. The Supabase client is
// a fake (lib/worker-board.harness.ts); lib/worker-board.test.ts covers the reads.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient, workerRow } from "./worker-board.harness";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));

const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>();
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));

const { sendWorkerAction, startWorkerThread } = await import("./worker-board");
const { OFFLINE_AFTER_MS } = await import("./workers-account");

const NOW = Date.parse("2026-10-29T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  syncOrgId.mockReset();
  syncOrgId.mockResolvedValue("org-1");
});

describe("sendWorkerAction", () => {
  const target = { owner_device: "dev-1", owner_worker: "w1", folder: "ling", owner_user: "u-1" };

  it("sends a reply as the row the web board sends", async () => {
    const { client, inserted } = fakeClient({ cardRow: target, insertId: "cmd-7" });
    expect(await sendWorkerAction({ action: "reply", cardId: "c1", text: "hello" }, client)).toEqual({ commandId: "cmd-7" });
    expect(inserted()).toEqual({
      org_id: "org-1",
      kind: "reply",
      target_device: "dev-1",
      folder: "ling",
      payload: { cardId: "c1", text: "hello" },
    });
  });

  it("carries a folder grant on the answer, with no path", async () => {
    const { client, inserted } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "answer", cardId: "c1", pendingId: "p1", allow: true, grant: "always" }, client);
    expect((inserted() as { payload: unknown }).payload).toEqual({ cardId: "c1", pendingId: "p1", allow: true, grant: "always" });
  });

  it("sends an answer as the row the web board sends", async () => {
    const { client, inserted } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "answer", cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a" } }, client);
    expect(inserted()).toEqual({
      org_id: "org-1",
      kind: "answer",
      target_device: "dev-1",
      folder: "ling",
      payload: { cardId: "c1", pendingId: "p1", allow: true, answers: { q: "a" } },
    });
  });

  it("sends a stop as the row the web board sends", async () => {
    const { client, inserted } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "stop", cardId: "c1" }, client);
    expect(inserted()).toEqual({
      org_id: "org-1",
      kind: "stop",
      target_device: "dev-1",
      folder: "ling",
      payload: { cardId: "c1" },
    });
  });

  it("sends a mode, and refuses YOLO", async () => {
    const { client, inserted } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "mode", cardId: "c1", mode: "auto" }, client);
    expect(inserted()).toMatchObject({ kind: "mode", payload: { cardId: "c1", mode: "auto" } });
    await expect(sendWorkerAction({ action: "mode", cardId: "c1", mode: "bypassPermissions" }, client)).rejects.toThrow("A worker doesn't run in that mode.");
  });

  it("sends a tap, and refuses a broken one", async () => {
    const { client, inserted } = fakeClient({ cardRow: target });
    await sendWorkerAction({ action: "input", cardId: "c1", input: { kind: "tap", device: "d", x: 0.5, y: 0.5 } }, client);
    expect(inserted()).toMatchObject({ kind: "input", payload: { cardId: "c1", device: "d" } });
    await expect(sendWorkerAction({ action: "input", cardId: "c1", input: { kind: "tap", device: "", x: 0, y: 0 } }, client)).rejects.toThrow("That tap can't be sent.");
  });

  it("says to write a message when the reply is empty", async () => {
    const { client } = fakeClient({ cardRow: target });
    await expect(sendWorkerAction({ action: "reply", cardId: "c1", text: "   " }, client)).rejects.toThrow("Write a message first.");
  });

  it("says nothing is waiting when the answer has no pending id", async () => {
    const { client } = fakeClient({ cardRow: target });
    await expect(sendWorkerAction({ action: "answer", cardId: "c1", pendingId: "", allow: true }, client)).rejects.toThrow("Nothing is waiting for an answer.");
  });

  it("refuses a card that no worker owns", async () => {
    const { client, inserted } = fakeClient({ cardRow: { ...target, owner_worker: null } });
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" }, client)).rejects.toThrow("That thread isn't on one of your workers.");
    expect(inserted()).toBeNull();
  });

  it("refuses a card another user owns", async () => {
    const { client, inserted } = fakeClient({ cardRow: { ...target, owner_user: "u-2" } });
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" }, client)).rejects.toThrow("That thread isn't on one of your workers.");
    expect(inserted()).toBeNull();
  });

  it("refuses a card it can't find", async () => {
    const { client } = fakeClient({ cardRow: null });
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" }, client)).rejects.toThrow("That thread isn't on one of your workers.");
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: null });
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" }, client)).rejects.toThrow("Sign in to Weft to reach your worker.");
  });

  it("throws the database's error", async () => {
    const { client } = fakeClient({ cardRow: target, insertError: { message: "boom" } });
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" }, client)).rejects.toThrow("Couldn't reach your worker: boom");
  });

  it("uses the account client by default", async () => {
    await expect(sendWorkerAction({ action: "stop", cardId: "c1" })).rejects.toThrow("no default client in tests");
  });
});

describe("startWorkerThread", () => {
  const online = workerRow({ last_seen_at: new Date(NOW).toISOString() });

  it("builds a run for the worker, in the project's folder", async () => {
    const { client, inserted } = fakeClient({ workers: [online], insertId: "cmd-3" });
    expect(await startWorkerThread({ cwd: "worker://w1/ling", prompt: "Add dark mode" }, client, NOW)).toEqual({ commandId: "cmd-3", worker: "m1mini" });
    expect(inserted()).toEqual({
      org_id: "org-1",
      kind: "run",
      target_device: "worker:w1",
      folder: "ling",
      payload: { prompt: "Add dark mode" },
    });
  });

  it("carries the title, the backend and the effort", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    await startWorkerThread({ cwd: "worker://w1/ling", prompt: "go", title: "Dark mode", backend: "codex", effort: "high" }, client, NOW);
    expect(inserted()).toMatchObject({
      payload: { prompt: "go", title: "Dark mode", backend: "codex", effort: "high" },
    });
  });

  it("never asks for a thread that runs without asking", async () => {
    const { client, inserted } = fakeClient({ workers: [online] });
    await startWorkerThread({ cwd: "worker://w1/ling", prompt: "go", permissionMode: "bypassPermissions" }, client, NOW);
    const row = inserted() as { payload: Record<string, unknown> };
    expect(row.payload.permissionMode).toBeUndefined();
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

  it("refuses an offline worker, and inserts nothing", async () => {
    const { client, inserted } = fakeClient({ workers: [workerRow({ last_seen_at: new Date(NOW - OFFLINE_AFTER_MS - 1).toISOString() })] });
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
