import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The folders' repos come from a mocked githubRepoOf; the team answer from a fake rpc that reads `linked`.
const repos = vi.hoisted(() => new Map<string, string>());
const linked = vi.hoisted(() => new Map<string, string>());
const settings = vi.hoisted(() => ({ sync: [] as string[], projects: [] as string[] }));
const accountClient = vi.hoisted(() => vi.fn());
const handlers = vi.hoisted(() => new Map<string, (folder: string) => void>());

const dir = vi.hoisted(() => ({ path: "" }));
vi.mock("./store", () => ({
  get DATA_DIR() {
    return dir.path;
  },
}));
vi.mock("./account", () => ({ accountClient }));
vi.mock("./repos", () => ({ githubRepoOf: (folder: string) => repos.get(folder) }));
vi.mock("./project-open", () => ({ onProjectOpen: (name: string, fn: (folder: string) => void) => handlers.set(name, fn) }));
vi.mock("./settings", () => ({
  listProjects: () => settings.projects.map((path) => ({ path, lastUsedAt: 0 })),
  syncFolders: () => [...settings.sync],
}));

const rpc = vi.fn((_fn: string, args: { repos: string[] }) =>
  Promise.resolve({ data: args.repos.filter((r) => linked.has(r)).map((r) => ({ repo: r, org_id: linked.get(r) })), error: null }),
);
// orgs: the team names a member can read; `in` records which ids were asked for.
const orgNames = new Map<string, string>();
const askedNames = vi.fn((ids: string[]) => Promise.resolve({ data: ids.filter((id) => orgNames.has(id)).map((id) => ({ id, name: orgNames.get(id) })), error: null }));
const from = vi.fn(() => ({ select: () => ({ in: (_col: string, ids: string[]) => askedNames(ids) }) }));
const client = { rpc, from } as never;

let team: typeof import("./cloud-sync-team");
let now = 0;

beforeEach(async () => {
  dir.path = fs.mkdtempSync(path.join(os.tmpdir(), "weft-team-sync-"));
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__weftTeamSyncFolders;
  delete (globalThis as Record<string, unknown>).__weftSyncRoutes;
  repos.clear();
  linked.clear();
  orgNames.clear();
  handlers.clear();
  settings.sync = [];
  settings.projects = [];
  vi.clearAllMocks();
  accountClient.mockReturnValue(client);
  now += 10 * 60_000; // past the route cache, so each test asks afresh
  team = await import("./cloud-sync-team");
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir.path, { recursive: true, force: true });
});

// A restart: the in-memory folders go, the backfilled file stays.
async function restart() {
  delete (globalThis as Record<string, unknown>).__weftTeamSyncFolders;
  vi.resetModules();
  team = await import("./cloud-sync-team");
}

describe("teamSyncNames", () => {
  it("names each team-synced folder's team, reading each team's name once", async () => {
    repos.set("/dev/app", "acme/app").set("/dev/api", "acme/api");
    linked.set("acme/app", "org-acme").set("acme/api", "org-acme");
    orgNames.set("org-acme", "Acme");
    await team.refreshTeamFolders(["/dev/app", "/dev/api"], client, now);
    await team.refreshTeamFolders(["/dev/app", "/dev/api"], client, now + 120_000);
    expect(team.teamSyncNames()).toEqual({ "/dev/app": "Acme", "/dev/api": "Acme" });
    expect(askedNames.mock.calls).toEqual([[["org-acme"]]]);
  });

  it("says 'your team' when the name can't be read, and the folder still syncs", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    askedNames.mockRejectedValueOnce(new Error("offline"));
    expect(await team.refreshTeamFolders(["/dev/app"], client, now)).toEqual(["/dev/app"]);
    expect(team.teamSyncNames()).toEqual({ "/dev/app": "your team" });
  });

  it("is empty with nothing team-synced", () => {
    expect(team.teamSyncNames()).toEqual({});
  });
});

describe("refreshTeamFolders", () => {
  it("team-syncs a folder whose repo a team linked, and returns it as newly linked", async () => {
    repos.set("/dev/app", "acme/app").set("/dev/mine", "me/mine");
    linked.set("acme/app", "org-acme");
    expect(await team.refreshTeamFolders(["/dev/app", "/dev/mine", "/tmp/no-repo"], client, now)).toEqual(["/dev/app"]);
    expect(team.teamSyncFolders()).toEqual(["/dev/app"]);
  });

  it("returns a linked folder only the first time", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    await team.refreshTeamFolders(["/dev/app"], client, now);
    expect(await team.refreshTeamFolders(["/dev/app"], client, now + 120_000)).toEqual([]);
    expect(team.teamSyncFolders()).toEqual(["/dev/app"]);
  });

  it("queues a folder the person already syncs too, so its older cards move into the team", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    settings.sync = ["/dev/app"];
    expect(await team.refreshTeamFolders(["/dev/app"], client, now)).toEqual(["/dev/app"]);
  });

  it("doesn't queue a project's history again after a restart", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    await team.refreshTeamFolders(["/dev/app"], client, now);
    await restart();
    expect(await team.refreshTeamFolders(["/dev/app"], client, now)).toEqual([]);
    expect(team.teamSyncFolders()).toEqual(["/dev/app"]);
  });

  it("keeps a folder it wasn't asked about as backfilled", async () => {
    repos.set("/dev/app", "acme/app").set("/dev/b", "acme/b");
    linked.set("acme/app", "org-acme").set("acme/b", "org-acme");
    await team.refreshTeamFolders(["/dev/app", "/dev/b"], client, now);
    await team.refreshTeamFolders(["/dev/app"], client, now);
    expect(await team.refreshTeamFolders(["/dev/app", "/dev/b"], client, now)).toEqual([]);
  });

  it("queues a folder again when it's linked after being unlinked", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    await team.refreshTeamFolders(["/dev/app"], client, now);
    linked.clear();
    await team.refreshTeamFolders(["/dev/app"], client, now + 120_000);
    linked.set("acme/app", "org-acme");
    expect(await team.refreshTeamFolders(["/dev/app"], client, now + 240_000)).toEqual(["/dev/app"]);
  });

  it("reads an unreadable backfilled file as empty", async () => {
    fs.writeFileSync(team.BACKFILLED_FILE, "{not json");
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    expect(await team.refreshTeamFolders(["/dev/app"], client, now)).toEqual(["/dev/app"]);
  });

  it("drops a folder once its team unlinks the repo", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    await team.refreshTeamFolders(["/dev/app"], client, now);
    linked.clear();
    await team.refreshTeamFolders(["/dev/app"], client, now + 120_000);
    expect(team.teamSyncFolders()).toEqual([]);
  });

  it("team-syncs nothing when signed out", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    await team.refreshTeamFolders(["/dev/app"], client, now);
    expect(await team.refreshTeamFolders(["/dev/app"], null, now)).toEqual([]);
    expect(team.teamSyncFolders()).toEqual([]);
  });

  it("asks nothing when no folder has a GitHub repo", async () => {
    expect(await team.refreshTeamFolders(["/tmp/x"], client, now)).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the account client by default, and none when it throws", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    expect(await team.refreshTeamFolders(["/dev/app"])).toEqual(["/dev/app"]);
    accountClient.mockImplementation(() => {
      throw new Error("no account");
    });
    expect(await team.refreshTeamFolders(["/dev/app"])).toEqual([]);
  });
});

describe("syncedFolders", () => {
  it("is the person's own folders plus the team's, once each", async () => {
    repos.set("/dev/app", "acme/app");
    linked.set("acme/app", "org-acme");
    settings.sync = ["/dev/mine", "/dev/app"];
    await team.refreshTeamFolders(["/dev/app"], client, now);
    expect(team.syncedFolders()).toEqual(["/dev/mine", "/dev/app"]);
  });
});

describe("startTeamSync", () => {
  it("queues newly linked folders at start, on a project opening and on the tick, and stops", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    repos.set("/dev/app", "acme/app").set("/dev/new", "acme/new").set("/dev/late", "acme/late");
    linked.set("acme/app", "org-a").set("acme/new", "org-a");
    settings.projects = ["/dev/app"];
    const queue = vi.fn();
    const stop = team.startTeamSync(queue);
    await vi.waitFor(() => expect(queue).toHaveBeenCalledWith("/dev/app"));
    handlers.get("team-sync")!("/dev/new");
    await vi.waitFor(() => expect(queue).toHaveBeenCalledWith("/dev/new"));
    expect(team.teamSyncFolders()).toEqual(["/dev/app", "/dev/new"]);
    settings.projects = ["/dev/app", "/dev/new", "/dev/late"];
    linked.set("acme/late", "org-a");
    await vi.advanceTimersByTimeAsync(team.TEAM_SYNC_EVERY_MS);
    await vi.waitFor(() => expect(queue).toHaveBeenCalledWith("/dev/late"));
    stop();
    queue.mockClear();
    await vi.advanceTimersByTimeAsync(team.TEAM_SYNC_EVERY_MS * 2);
    expect(queue).not.toHaveBeenCalled();
  });

  it("warns once per streak of failures", async () => {
    repos.set("/dev/app", "acme/app");
    settings.projects = ["/dev/app"];
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } } as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = team.startTeamSync(vi.fn());
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    handlers.get("team-sync")!("/dev/app");
    await new Promise((r) => setTimeout(r, 5));
    expect(warn).toHaveBeenCalledTimes(1);
    stop();
    warn.mockRestore();
  });
});
