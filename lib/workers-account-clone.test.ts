import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { newSealKeys } from "./worker-seal";

// The clone and GitHub sides of lib/workers-account.ts: the worker's row and the commands the board sends it.
vi.mock("./account", () => ({ accountClient: () => { throw new Error("no default client in tests"); } }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve("org-1") }));
vi.mock("./device-id", () => ({ deviceId: () => "dev-here" }));

const { commandResult, listWorkers, sendClone, sendGithubLogin } = await import("./workers-account");
const TOKEN = `github_pat_${"a".repeat(30)}`;

let inserted: unknown[];
beforeEach(() => {
  inserted = [];
});

interface Opts {
  user?: string | null;
  publicKey?: string;
  insertError?: { message: string };
  command?: unknown;
  commandError?: { message: string };
  workers?: unknown[];
  signIns?: unknown[] | null;
  clones?: unknown[] | null;
}

function fakeClient(opts: Opts = {}) {
  const from = (table: string) => {
    let columns = "";
    const query = {
      select: (c: string) => ((columns = c), query),
      eq: () => query,
      order: () => query,
      limit: () => query,
      insert: (row: unknown) => (inserted.push(row), query),
      maybeSingle: () => Promise.resolve({ data: table === "cloud_workers" ? { public_key: opts.publicKey ?? null } : (opts.command ?? null), error: opts.commandError ?? null }),
      single: () => Promise.resolve({ data: opts.insertError ? null : { id: "cmd-7" }, error: opts.insertError ?? null }),
      then: (resolve: (v: unknown) => unknown) => {
        const data = table === "cloud_commands" ? opts.clones : columns.includes("github_state") ? opts.signIns : opts.workers;
        return Promise.resolve({ data: data ?? null, error: null }).then(resolve);
      },
    };
    return query;
  };
  return {
    auth: { getSession: () => Promise.resolve({ data: { session: opts.user === null ? null : { user: { id: opts.user ?? "u-1" } } } }) },
    from,
  } as unknown as SupabaseClient;
}

const worker = { id: "w-1", owner_user: "u-1", name: "m1mini", platform: "darwin", arch: "arm64", status: "online", last_seen_at: null };

describe("listWorkers", () => {
  it("adds the worker's GitHub sign-in and its latest failed clone", async () => {
    const view = await listWorkers(
      fakeClient({
        workers: [worker],
        signIns: [{ id: "w-1", github_account: "octocat", github_state: "expired" }],
        clones: [
          { target_device: "worker:w-1", status: "failed", error: "no sign-in" },
          { target_device: "worker:w-1", status: "done", error: null },
        ],
      }),
    );
    expect(view.workers[0]).toMatchObject({ githubAccount: "octocat", githubState: "expired", cloneError: "no sign-in" });
  });

  it("lets a newer clone that worked clear an older failure, and words a failure with no reason", async () => {
    const view = await listWorkers(
      fakeClient({
        workers: [worker, { ...worker, id: "w-2" }],
        clones: [
          { target_device: "worker:w-1", status: "done", error: null },
          { target_device: "worker:w-1", status: "failed", error: "old" },
          { target_device: "worker:w-2", status: "failed", error: null },
        ],
      }),
    );
    expect(view.workers.map((w) => w.cloneError)).toEqual([null, "The clone failed."]);
  });

  it("still lists workers on a database with no GitHub columns", async () => {
    const view = await listWorkers(fakeClient({ workers: [worker], signIns: null, clones: null }));
    expect(view.workers[0]).toMatchObject({ name: "m1mini", githubAccount: null, githubState: null, cloneError: null });
  });
});

describe("sendGithubLogin", () => {
  it("seals the token to the worker and never puts it in the row", async () => {
    const client = fakeClient({ publicKey: newSealKeys().publicKey });
    expect(await sendGithubLogin({ workerId: "w-1", token: TOKEN }, client)).toEqual({ commandId: "cmd-7" });
    expect(inserted[0]).toMatchObject({ org_id: "org-1", kind: "github_login", target_device: "worker:w-1" });
    expect(JSON.stringify(inserted[0])).not.toContain("github_pat_");
  });

  it("refuses a token that isn't one, and asks for an update with no key", async () => {
    await expect(sendGithubLogin({ workerId: "w-1", token: "nope" }, fakeClient({ publicKey: newSealKeys().publicKey }))).rejects.toThrow("doesn't look like a GitHub token");
    await expect(sendGithubLogin({ workerId: "w-1", token: TOKEN }, fakeClient())).rejects.toThrow("hasn't published its key yet");
  });
});

describe("sendClone", () => {
  it("queues a clone with no prompt, named for the repo", async () => {
    expect(await sendClone({ workerId: "w-1", repo: "aimhuge/weft" }, fakeClient())).toEqual({ commandId: "cmd-7" });
    expect(inserted[0]).toEqual({ org_id: "org-1", kind: "clone", target_device: "worker:w-1", folder: "weft", payload: { repo: "https://github.com/aimhuge/weft.git" } });
  });

  it("refuses what isn't owner/name, needs you signed in, and says when the insert fails", async () => {
    await expect(sendClone({ workerId: "w-1", repo: "nope" }, fakeClient())).rejects.toThrow("Use owner/name");
    await expect(sendClone({ workerId: "w-1", repo: "a/b" }, fakeClient({ user: null }))).rejects.toThrow("Sign in to Weft");
    await expect(sendClone({ workerId: "w-1", repo: "a/b" }, fakeClient({ insertError: { message: "denied" } }))).rejects.toThrow("Couldn't send the clone: denied");
  });
});

describe("commandResult", () => {
  it("reads how a command went", async () => {
    expect(await commandResult("cmd-7", fakeClient({ command: { status: "failed", error: "no" } }))).toEqual({ status: "failed", error: "no" });
  });

  it("says when it can't", async () => {
    await expect(commandResult("cmd-7", fakeClient({ commandError: { message: "denied" } }))).rejects.toThrow("Couldn't read that command: denied");
    await expect(commandResult("cmd-7", fakeClient())).rejects.toThrow("That command is gone.");
  });
});
