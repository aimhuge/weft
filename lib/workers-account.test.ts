import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));

const syncOrgId = vi.fn<(client: unknown, uid: string) => Promise<string | null>>();
vi.mock("./cloud-sync", () => ({ syncOrgId: (client: unknown, uid: string) => syncOrgId(client, uid) }));

vi.mock("./device-id", () => ({ deviceId: () => "dev-here" }));

const { enrolToken, installLine, listWorkers, OFFLINE_AFTER_MS, removeWorker, sendRun } = await import("./workers-account");

interface FakeOptions {
  user?: string | null;
  org?: string | null;
  rows?: unknown[] | null;
  error?: { message: string } | null;
  rpcData?: unknown;
  rpcError?: { message: string } | null;
  insertError?: { message: string } | null;
  insertId?: string;
  deleteError?: { message: string } | null;
  workerRow?: { kind: string | null; device: string | null } | null;
}

function fakeClient(opts: FakeOptions = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const rows = opts.rows === undefined ? [] : opts.rows;
  let deleting = false;
  const query = {
    select: (...args: unknown[]) => (calls.push({ op: "select", args }), query),
    eq: (...args: unknown[]) => (calls.push({ op: "eq", args }), query),
    order: (...args: unknown[]) => (calls.push({ op: "order", args }), query),
    limit: () => query,
    insert: (...args: unknown[]) => (calls.push({ op: "insert", args }), query),
    maybeSingle: () => Promise.resolve({ data: opts.workerRow ?? null, error: null }),
    single: () =>
      Promise.resolve({
        data: opts.insertError ? null : { id: opts.insertId ?? "cmd-1" },
        error: opts.insertError ?? null,
      }),
    delete: () => {
      calls.push({ op: "delete", args: [] });
      deleting = true;
      return query;
    },
    then: (resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
      Promise.resolve({
        data: deleting ? null : rows,
        error: deleting ? (opts.deleteError ?? null) : (opts.error ?? null),
      }).then(resolve),
  };
  const client = {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: opts.user === null ? null : { user: { id: opts.user ?? "u-1" } } } }),
    },
    from: (table: string) => (calls.push({ op: "from", args: [table] }), query),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ op: "rpc", args: [fn, args] });
      return Promise.resolve({ data: opts.rpcData ?? null, error: opts.rpcError ?? null });
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

beforeEach(() => {
  syncOrgId.mockReset();
  syncOrgId.mockResolvedValue("org-1");
});

describe("listWorkers", () => {
  it("is signed out with no session", async () => {
    const { client, calls } = fakeClient({ user: null });
    expect(await listWorkers(client)).toEqual({ signedIn: false, workers: [] });
    expect(calls).toEqual([]);
    expect(syncOrgId).not.toHaveBeenCalled();
  });

  it("throws when the user is in no workspace", async () => {
    const { client } = fakeClient();
    syncOrgId.mockResolvedValue(null);
    await expect(listWorkers(client)).rejects.toThrow("You aren't in a Weft workspace yet.");
  });

  it("reads the workspace's workers", async () => {
    const { client, calls } = fakeClient({
      rows: [
        { id: "w-1", owner_user: "u-1", name: "mini", platform: "darwin", arch: "arm64", status: "online", last_seen_at: null },
      ],
    });
    const now = Date.parse("2026-10-29T10:00:00.000Z");
    expect(await listWorkers(client, now)).toEqual({
      signedIn: true,
      workers: [
        { id: "w-1", name: "mini", platform: "darwin", arch: "arm64", status: "offline", lastSeenAt: null, mine: true, kind: "headless", device: null, here: false, githubAccount: null, githubState: null, cloneError: null },
      ],
    });
    expect(calls[0]).toEqual({ op: "from", args: ["cloud_workers"] });
    expect(calls).toContainEqual({ op: "eq", args: ["org_id", "org-1"] });
    expect(calls).toContainEqual({ op: "order", args: ["created_at", { ascending: true }] });
  });

  it("marks a worker that hasn't been seen lately as offline", async () => {
    const now = Date.parse("2026-10-29T10:00:00.000Z");
    const { client } = fakeClient({
      rows: [
        {
          id: "w-1",
          owner_user: "u-1",
          name: "mini",
          platform: "linux",
          arch: "x64",
          status: "online",
          last_seen_at: new Date(now - OFFLINE_AFTER_MS - 1).toISOString(),
        },
      ],
    });
    const view = await listWorkers(client, now);
    expect(view.workers[0]?.status).toBe("offline");
  });

  it("keeps a worker that was seen just now as it says", async () => {
    const now = Date.parse("2026-10-29T10:00:00.000Z");
    const { client } = fakeClient({
      rows: [
        {
          id: "w-1",
          owner_user: "u-1",
          name: "mini",
          platform: "linux",
          arch: "x64",
          status: "busy",
          last_seen_at: new Date(now - 1000).toISOString(),
        },
      ],
    });
    const view = await listWorkers(client, now);
    expect(view.workers[0]?.status).toBe("busy");
  });

  it("says whose worker it is", async () => {
    const now = Date.parse("2026-10-29T10:00:00.000Z");
    const { client } = fakeClient({
      rows: [
        {
          id: "w-1",
          owner_user: "u-2",
          name: "mini",
          platform: "linux",
          arch: "x64",
          status: "online",
          last_seen_at: new Date(now).toISOString(),
        },
      ],
    });
    const view = await listWorkers(client, now);
    expect(view.workers[0]?.mine).toBe(false);
  });

  it("tells a desktop (headed) worker from a headless one, and knows this Mac's", async () => {
    const now = Date.parse("2026-10-29T10:00:00.000Z");
    const seen = new Date(now).toISOString();
    const row = { owner_user: "u-1", name: "air", platform: "darwin", arch: "arm64", status: "online", last_seen_at: seen, kind: "desktop" };
    const { client } = fakeClient({
      rows: [
        { ...row, id: "d-here", device: "dev-here" },
        { ...row, id: "d-other", device: "dev-other" },
        { ...row, id: "d-theirs", device: "dev-here", owner_user: "u-2" },
      ],
    });
    const view = await listWorkers(client, now);
    expect(view.workers.map((w) => [w.id, w.kind, w.device, w.here])).toEqual([
      ["d-here", "desktop", "dev-here", true],
      ["d-other", "desktop", "dev-other", false],
      ["d-theirs", "desktop", "dev-here", false],
    ]);
  });

  it("treats no rows as no workers", async () => {
    const { client } = fakeClient({ rows: null });
    expect(await listWorkers(client)).toEqual({ signedIn: true, workers: [] });
  });

  it("throws the database's error", async () => {
    const { client } = fakeClient({ error: { message: "boom" } });
    await expect(listWorkers(client)).rejects.toThrow("Couldn't read your workers: boom");
  });

  it("uses the account client by default", async () => {
    await expect(listWorkers()).rejects.toThrow("no default client in tests");
  });
});

describe("installLine", () => {
  it("is the install script with the token", () => {
    expect(installLine("tok-1")).toBe("curl -fsSL https://weft.zip/worker.sh | sh -s -- tok-1");
  });
});

describe("enrolToken", () => {
  it("makes a token and the line to run", async () => {
    const { client, calls } = fakeClient({ rpcData: "tok-1" });
    expect(await enrolToken(client)).toEqual({ token: "tok-1", command: installLine("tok-1") });
    expect(calls).toContainEqual({ op: "rpc", args: ["worker_enrol_token", { p_org: "org-1" }] });
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: null });
    await expect(enrolToken(client)).rejects.toThrow("Sign in to Weft to add a worker.");
  });

  it("refuses when the user is in no workspace", async () => {
    const { client } = fakeClient();
    syncOrgId.mockResolvedValue(null);
    await expect(enrolToken(client)).rejects.toThrow("You aren't in a Weft workspace yet.");
  });

  it("throws the database's error", async () => {
    const { client } = fakeClient({ rpcError: { message: "boom" } });
    await expect(enrolToken(client)).rejects.toThrow("Couldn't make a token: boom");
  });

  it("uses the account client by default", async () => {
    await expect(enrolToken()).rejects.toThrow("no default client in tests");
  });
});

describe("sendRun", () => {
  it("inserts a run command and says its id", async () => {
    const { client, calls } = fakeClient({ insertId: "cmd-9" });
    expect(
      await sendRun({ workerId: "w-1", folder: "weft", prompt: "Add dark mode", repo: "https://github.com/a/b.git" }, client),
    ).toEqual({ commandId: "cmd-9" });
    const insert = calls.find((c) => c.op === "insert");
    expect(insert?.args[0]).toEqual({
      org_id: "org-1",
      kind: "run",
      target_device: "worker:w-1",
      folder: "weft",
      payload: { prompt: "Add dark mode", repo: "https://github.com/a/b.git" },
    });
    expect(calls).toContainEqual({ op: "from", args: ["cloud_commands"] });
  });

  it("sends a desktop worker a new card for its own device, by project name", async () => {
    const { client, calls } = fakeClient({ insertId: "cmd-7", workerRow: { kind: "desktop", device: "dev-air" } });
    expect(await sendRun({ workerId: "d-1", folder: " weft ", prompt: "Add dark mode" }, client)).toEqual({ commandId: "cmd-7" });
    expect(calls).toContainEqual({ op: "eq", args: ["id", "d-1"] });
    expect(calls.find((c) => c.op === "insert")?.args[0]).toEqual({
      org_id: "org-1",
      kind: "new_card",
      target_device: "dev-air",
      folder: "weft",
      payload: { prompt: "Add dark mode" },
    });
  });

  it("refuses a desktop run with no folder", async () => {
    const { client } = fakeClient({ workerRow: { kind: "desktop", device: "dev-air" } });
    await expect(sendRun({ workerId: "d-1", folder: " ", prompt: "go" }, client)).rejects.toThrow("A run needs a project folder and a prompt.");
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: null });
    await expect(sendRun({ workerId: "w-1", folder: "weft", prompt: "go" }, client)).rejects.toThrow(
      "Sign in to Weft to send a run.",
    );
  });

  it("refuses a run with no prompt or no folder", async () => {
    const { client } = fakeClient();
    await expect(sendRun({ workerId: "w-1", folder: "weft", prompt: "  " }, client)).rejects.toThrow(
      "A run needs a project folder and a prompt.",
    );
    await expect(sendRun({ workerId: "w-1", folder: "  ", prompt: "go" }, client)).rejects.toThrow(
      "A run needs a project folder and a prompt.",
    );
  });

  it("throws the database's error", async () => {
    const { client } = fakeClient({ insertError: { message: "boom" } });
    await expect(sendRun({ workerId: "w-1", folder: "weft", prompt: "go" }, client)).rejects.toThrow(
      "Couldn't send the run: boom",
    );
  });

  it("uses the account client by default", async () => {
    await expect(sendRun({ workerId: "w-1", folder: "weft", prompt: "go" })).rejects.toThrow("no default client in tests");
  });
});

describe("removeWorker", () => {
  it("deletes the worker by id", async () => {
    const { client, calls } = fakeClient();
    await removeWorker("w-1", client);
    expect(calls).toEqual([
      { op: "from", args: ["cloud_workers"] },
      { op: "delete", args: [] },
      { op: "eq", args: ["id", "w-1"] },
    ]);
  });

  it("refuses when signed out", async () => {
    const { client } = fakeClient({ user: null });
    await expect(removeWorker("w-1", client)).rejects.toThrow("Sign in to Weft to remove a worker.");
  });

  it("throws the database's error", async () => {
    const { client } = fakeClient({ deleteError: { message: "boom" } });
    await expect(removeWorker("w-1", client)).rejects.toThrow("Couldn't remove that worker: boom");
  });

  it("uses the account client by default", async () => {
    await expect(removeWorker("w-1")).rejects.toThrow("no default client in tests");
  });
});
