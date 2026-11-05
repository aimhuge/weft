import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake Supabase client that records what each call sent; the folders' repos come from a mocked githubRepoOf.
const repos = vi.hoisted(() => new Map<string, string>());
const settings = vi.hoisted(() => ({ sync: [] as string[], projects: [] as string[] }));
const accountClient = vi.hoisted(() => vi.fn());
const queueFolder = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => new Map<string, (folder: string) => void>());

vi.mock("./account", () => ({ accountClient }));
vi.mock("./cloud-sync", () => ({ queueFolder }));
vi.mock("./repos", () => ({ githubRepoOf: (folder: string) => repos.get(folder) }));
vi.mock("./project-open", () => ({ onProjectOpen: (name: string, fn: (folder: string) => void) => handlers.set(name, fn) }));
vi.mock("./settings", () => ({
  listProjects: () => settings.projects.map((path) => ({ path, lastUsedAt: 0 })),
  syncFolders: () => [...settings.sync],
  setSyncFolder: (folder: string, on: boolean) => {
    settings.sync = on ? [...settings.sync.filter((f) => f !== folder), folder] : settings.sync.filter((f) => f !== folder);
  },
}));

const { ADOPT_EVERY_MS, adoptSyncRepos, rememberSyncRepo, startSyncRepos } = await import("./cloud-sync-repos");

type Answer = { data?: unknown; error?: { message: string } | null };

function fakeClient({ user = "u1", upsert = {}, select = { data: [] } }: { user?: string | null; upsert?: Answer; select?: Answer } = {}) {
  const calls = { upsert: [] as unknown[][], select: [] as unknown[][] };
  const query = {
    eq: vi.fn(() => query),
    then: (resolve: (a: Answer) => unknown) => Promise.resolve({ error: null, ...select }).then(resolve),
  };
  const client = {
    auth: { getSession: () => Promise.resolve({ data: { session: user ? { user: { id: user } } : null } }) },
    from: vi.fn(() => ({
      upsert: (...args: unknown[]) => {
        calls.upsert.push(args);
        return Promise.resolve({ error: null, ...upsert });
      },
      select: (...args: unknown[]) => {
        calls.select.push(args);
        return query;
      },
    })),
  };
  return { client: client as never, calls, query };
}

beforeEach(() => {
  repos.clear();
  handlers.clear();
  settings.sync = [];
  settings.projects = [];
  vi.clearAllMocks();
});

describe("rememberSyncRepo", () => {
  it("upserts the folder's repo with the switch, as the signed-in user", async () => {
    repos.set("/dev/app", "me/app");
    const { client, calls } = fakeClient();
    await rememberSyncRepo("/dev/app", false, client);
    expect(calls.upsert).toEqual([[{ owner_user: "u1", repo: "me/app", enabled: false }, { onConflict: "owner_user,repo" }]]);
  });

  it("does nothing for a folder with no GitHub origin, signed out, or with no client", async () => {
    const { client, calls } = fakeClient({ user: null });
    await rememberSyncRepo("/dev/plain", true, client);
    repos.set("/dev/app", "me/app");
    await rememberSyncRepo("/dev/app", true, client);
    await rememberSyncRepo("/dev/app", true, null);
    expect(calls.upsert).toEqual([]);
  });

  it("throws the server's error", async () => {
    repos.set("/dev/app", "me/app");
    const { client } = fakeClient({ upsert: { error: { message: "denied" } } });
    await expect(rememberSyncRepo("/dev/app", true, client)).rejects.toThrow("Couldn't record sync for me/app: denied");
  });

  it("uses the account's client by default, and treats a throwing one as signed out", async () => {
    repos.set("/dev/app", "me/app");
    accountClient.mockImplementationOnce(() => {
      throw new Error("no session");
    });
    await expect(rememberSyncRepo("/dev/app", true)).resolves.toBeUndefined();
  });
});

describe("adoptSyncRepos", () => {
  it("turns sync on for local clones of enabled repos, ignoring case, and queues their cards", async () => {
    repos.set("/b/app", "me/app").set("/b/other", "me/other").set("/b/web", "Me/Web");
    const { client, query } = fakeClient({ select: { data: [{ repo: "me/app" }, { repo: "me/web" }] } });
    expect(await adoptSyncRepos(["/b/app", "/b/other", "/b/web", "/b/plain", "/b/app"], client)).toEqual(["/b/app", "/b/web"]);
    expect(settings.sync).toEqual(["/b/app", "/b/web"]);
    expect(queueFolder.mock.calls).toEqual([["/b/app"], ["/b/web"]]);
    expect(query.eq.mock.calls).toEqual([["owner_user", "u1"], ["enabled", true]]);
  });

  it("publishes the repos this Mac already syncs without overriding another Mac's switch, and skips them", async () => {
    repos.set("/a/app", "me/app").set("/a/app-2", "me/app");
    settings.sync = ["/a/app", "/a/app-2", "/a/plain"];
    const { client, calls } = fakeClient({ select: { data: [{ repo: "me/app" }] } });
    expect(await adoptSyncRepos(["/a/app"], client)).toEqual([]);
    expect(calls.upsert).toEqual([
      [[{ owner_user: "u1", repo: "me/app", enabled: true }], { onConflict: "owner_user,repo", ignoreDuplicates: true }],
    ]);
    expect(queueFolder).not.toHaveBeenCalled();
  });

  it("reads the recent projects by default and copes with no rows", async () => {
    settings.projects = ["/b/app"];
    repos.set("/b/app", "me/app");
    const { client } = fakeClient({ select: { data: null } });
    expect(await adoptSyncRepos(undefined, client)).toEqual([]);
  });

  it("does nothing signed out", async () => {
    const { client, calls } = fakeClient({ user: null });
    expect(await adoptSyncRepos(["/b/app"], client)).toEqual([]);
    expect(await adoptSyncRepos(["/b/app"], null)).toEqual([]);
    expect(calls.select).toEqual([]);
  });

  it("throws when publishing or reading fails", async () => {
    repos.set("/a/app", "me/app");
    settings.sync = ["/a/app"];
    await expect(adoptSyncRepos([], fakeClient({ upsert: { error: { message: "no table" } } }).client)).rejects.toThrow(
      "Couldn't publish synced repos: no table",
    );
    await expect(adoptSyncRepos([], fakeClient({ select: { error: { message: "denied" } } }).client)).rejects.toThrow(
      "Couldn't read synced repos: denied",
    );
  });
});

describe("startSyncRepos", () => {
  afterEach(() => vi.useRealTimers());

  it("adopts at start, every minute, and for a project as it opens; logs what it turned on", async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    repos.set("/b/app", "me/app");
    settings.projects = ["/b/app"];
    const { client, calls } = fakeClient({ select: { data: [{ repo: "me/app" }] } });
    accountClient.mockReturnValue(client);
    const stop = startSyncRepos();
    await vi.waitFor(() => expect(settings.sync).toEqual(["/b/app"]));
    expect(log).toHaveBeenCalledWith("[weft] project sync turned on from your other Macs: /b/app");
    await vi.advanceTimersByTimeAsync(ADOPT_EVERY_MS);
    expect(calls.select.length).toBe(2);
    repos.set("/b/new", "me/app");
    handlers.get("sync-repos")!("/b/new");
    await vi.waitFor(() => expect(settings.sync).toEqual(["/b/app", "/b/new"]));
    stop();
    await vi.advanceTimersByTimeAsync(ADOPT_EVERY_MS);
    expect(calls.select.length).toBe(3);
    log.mockRestore();
  });

  it("warns once per streak of failures", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = fakeClient({ select: { error: { message: "no table" } } }).client;
    accountClient.mockReturnValue(failing);
    const stop = startSyncRepos();
    await vi.advanceTimersByTimeAsync(ADOPT_EVERY_MS * 2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[weft] project sync across Macs:", "Error: Couldn't read synced repos: no table");
    accountClient.mockReturnValue(fakeClient().client);
    await vi.advanceTimersByTimeAsync(ADOPT_EVERY_MS);
    accountClient.mockReturnValue(failing);
    await vi.advanceTimersByTimeAsync(ADOPT_EVERY_MS);
    expect(warn).toHaveBeenCalledTimes(2);
    stop();
    warn.mockRestore();
  });
});
