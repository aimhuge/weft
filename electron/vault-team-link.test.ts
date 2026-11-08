import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultDeviceRequest, VaultJoin } from "../lib/vault-shared";
import { RETRY_MS, askedStore, autoAsk, createTeamUpkeep, linkedOf, linkedRepos, newRequests, requestNotice } from "./vault-team-link.cjs";

// A waiting Mac with only the fields a test cares about.
const req = (r: Partial<VaultDeviceRequest> & { id: string }): VaultDeviceRequest => ({ person: "", deviceName: "", fingerprint: "", ...r });

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const client = (rpc: (...args: unknown[]) => unknown, signedIn = true) => ({ supabase: { rpc: vi.fn(rpc) }, signedIn: () => signedIn });

describe("linkedRepos", () => {
  it("maps each linked repo, lower-cased, to its org and skips rows missing either", async () => {
    const accountClient = client(() => Promise.resolve({ data: [{ repo: "Owner/Name", org_id: "org-1" }, { repo: "x/y" }, { org_id: "org-2" }, null], error: null }));
    const linked = await linkedRepos({ accountClient, repos: ["Owner/Name", "x/y"] });
    expect([...linked]).toEqual([["owner/name", "org-1"]]);
    expect(accountClient.supabase.rpc).toHaveBeenCalledWith("team_orgs_for_repos", { repos: ["Owner/Name", "x/y"] });
  });

  it("answers nothing with no data", async () => {
    expect((await linkedRepos({ accountClient: client(() => Promise.resolve({ data: null, error: null })), repos: ["a/b"] })).size).toBe(0);
  });

  it("answers nothing signed out, with no client, no repos, an rpc error or a throw", async () => {
    const ok = () => Promise.resolve({ data: [{ repo: "a/b", org_id: "o" }], error: null });
    const signedOut = client(ok, false);
    expect((await linkedRepos({ accountClient: signedOut, repos: ["a/b"] })).size).toBe(0);
    expect(signedOut.supabase.rpc).not.toHaveBeenCalled();
    expect((await linkedRepos({ accountClient: undefined, repos: ["a/b"] })).size).toBe(0);
    expect((await linkedRepos({ accountClient: client(ok), repos: [] })).size).toBe(0);
    expect((await linkedRepos({ accountClient: client(() => Promise.resolve({ data: null, error: { message: "no" } })), repos: ["a/b"] })).size).toBe(0);
    expect((await linkedRepos({ accountClient: client(() => Promise.reject(new Error("offline"))), repos: ["a/b"] })).size).toBe(0);
  });

  it("asks without a signedIn function at all", async () => {
    const accountClient = { supabase: { rpc: vi.fn(() => Promise.resolve({ data: [{ repo: "a/b", org_id: "o" }], error: null })) } };
    expect((await linkedRepos({ accountClient, repos: ["a/b"] })).get("a/b")).toBe("o");
  });
});

describe("linkedOf", () => {
  it("marks the GitHub vaults a known team linked and answers the links", async () => {
    const accountClient = client(() => Promise.resolve({ data: [{ repo: "owner/name", org_id: "org-1" }, { repo: "owner/other", org_id: "org-gone" }], error: null }));
    const vaults: { id: string; linked?: { orgId: string; name: string } }[] = [{ id: "github:owner/name" }, { id: "github:owner/other" }, { id: "local:abc" }, { id: "github:owner/none" }];
    const linked = await linkedOf({ accountClient, vaults, orgs: [{ id: "org-1", name: "Team" }] });
    expect(accountClient.supabase.rpc).toHaveBeenCalledWith("team_orgs_for_repos", { repos: ["owner/name", "owner/other", "owner/none"] });
    expect(vaults[0]!.linked).toEqual({ orgId: "org-1", name: "Team" });
    expect(vaults[1]!.linked).toBeUndefined();
    expect(vaults[2]!.linked).toBeUndefined();
    expect(vaults[3]!.linked).toBeUndefined();
    expect(linked.size).toBe(2);
  });
});

describe("askedStore", () => {
  it("starts empty, remembers ids across instances and creates its folder", () => {
    const dir = path.join(tempDir(), "nested");
    const store = askedStore(dir);
    expect(store.has("v1")).toBe(false);
    store.add("v1");
    store.add("v2");
    expect(askedStore(dir).has("v1")).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "team-asked.json"), "utf8"))).toEqual(["v1", "v2"]);
  });

  it("reads a file that isn't a list, or isn't JSON, as empty", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "team-asked.json"), JSON.stringify({ v1: true }));
    expect(askedStore(dir).has("v1")).toBe(false);
    fs.writeFileSync(path.join(dir, "team-asked.json"), "not json");
    expect(askedStore(dir).has("v1")).toBe(false);
  });
});

describe("autoAsk", () => {
  const join = (vaultId: string, extra: Partial<VaultJoin> = {}): VaultJoin => ({ vaultId, repo: "Owner/Name", orgId: "org-1", state: "none", fingerprint: "ab", ...extra });

  it("asks once for each linked vault in the linking team it isn't in yet", async () => {
    const asked = askedStore(tempDir());
    asked.add("already");
    const joins = new Map([
      ["a", join("ok")],
      ["b", join("asked-state", { state: "asked" })],
      ["c", join("granted", { state: "granted" })],
      ["d", join("unlinked", { repo: "other/repo" })],
      ["e", join("other-org", { orgId: "org-2" })],
      ["f", join("already")],
    ]);
    const requestJoin = vi.fn(() => Promise.resolve({}));
    const now = await autoAsk({ joins, linked: new Map([["owner/name", "org-1"]]), asked, requestJoin });
    expect(now).toEqual(["ok"]);
    expect(requestJoin).toHaveBeenCalledTimes(1);
    expect(requestJoin).toHaveBeenCalledWith("ok");
    expect(asked.has("ok")).toBe(true);
    expect(await autoAsk({ joins, linked: new Map([["owner/name", "org-1"]]), asked, requestJoin })).toEqual([]);
  });

  it("doesn't record a vault whose request throws, logs it once and retries it after the wait", async () => {
    const asked = askedStore(tempDir());
    const failed = new Map<string, number>();
    const warn = vi.fn();
    const requestJoin = vi.fn(() => Promise.reject(new Error("offline")));
    const deps = { joins: new Map([["a", join("v1")]]), linked: new Map([["owner/name", "org-1"]]), asked, failed, requestJoin, warn };
    expect(await autoAsk({ ...deps, at: 1000 })).toEqual([]);
    expect(asked.has("v1")).toBe(false);
    expect(failed.get("v1")).toBe(1000);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/v1.*offline/));
    // Inside the wait it isn't tried; after it, it is, and a second failure stays quiet.
    await autoAsk({ ...deps, at: 1000 + RETRY_MS - 1 });
    expect(requestJoin).toHaveBeenCalledOnce();
    await autoAsk({ ...deps, at: 1000 + RETRY_MS });
    expect(requestJoin).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledOnce();
    expect(asked.has("v1")).toBe(false);
    // The retry that goes through is recorded and never repeated.
    requestJoin.mockImplementation(() => Promise.resolve({}) as never);
    expect(await autoAsk({ ...deps, at: 1000 + 2 * RETRY_MS })).toEqual(["v1"]);
    expect(asked.has("v1")).toBe(true);
    expect(failed.has("v1")).toBe(false);
    expect(await autoAsk({ ...deps, at: 1000 + 10 * RETRY_MS })).toEqual([]);
    expect(requestJoin).toHaveBeenCalledTimes(3);
  });

  it("logs a thrown non-Error, and defaults the clock, the failures and the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const asked = askedStore(tempDir());
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a server lib may throw a plain string
    const requestJoin = vi.fn(() => Promise.reject("nope"));
    expect(await autoAsk({ joins: new Map([["a", join("v1")]]), linked: new Map([["owner/name", "org-1"]]), asked, requestJoin })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/v1.*nope/));
    expect(asked.has("v1")).toBe(false);
    warn.mockRestore();
  });
});

describe("newRequests", () => {
  it("tells each request once", () => {
    const seen = new Set<string>();
    const requests = new Map([
      ["v1", [req({ id: "r1" }), req({ id: "r2" })]],
      ["v2", [req({ id: "r3" })]],
    ]);
    expect(newRequests(requests, seen).map((r: { id: string }) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(newRequests(requests, seen)).toEqual([]);
    requests.get("v2")!.push(req({ id: "r4" }));
    expect(newRequests(requests, seen).map((r: { id: string }) => r.id)).toEqual(["r4"]);
  });
});

describe("requestNotice", () => {
  it("says nothing for none, names one Mac, and counts several", () => {
    expect(requestNotice([])).toBeNull();
    expect(requestNotice([{ person: "Ann", deviceName: "Ann's Air" }])).toEqual({
      title: "A teammate's Mac wants your team's secrets",
      body: "Ann asks to add Ann's Air. Open 🔐 to approve it once for the team.",
    });
    expect(requestNotice([{ person: "Ann", deviceName: "a" }, { person: "Bo", deviceName: "b" }])?.body).toBe("2 Macs ask to join your team's vaults. Open 🔐 to approve them.");
  });
});

describe("createTeamUpkeep", () => {
  const linked = new Map([["owner/name", "org-1"]]);
  const joinTeam = (requests = new Map<string, VaultDeviceRequest[]>()) => ({ joins: new Map<string, VaultJoin>([["a", { vaultId: "v1", repo: "owner/name", orgId: "org-1", state: "none", fingerprint: "ab" }]]), requests });
  const idleTeam = (requests = new Map<string, VaultDeviceRequest[]>()) => ({ joins: new Map<string, VaultJoin>(), requests });
  const setup = (sealed = 0, accountClient: unknown = client(() => Promise.resolve({}))) => {
    const order: string[] = [];
    const api = {
      requestJoin: vi.fn(() => {
        order.push("ask");
        return Promise.resolve({});
      }),
      sealTrusted: vi.fn(() => {
        order.push("seal");
        return Promise.resolve({ sealed });
      }),
    };
    const deps = { dir: tempDir(), accountClient, sharedApi: vi.fn(() => Promise.resolve(api)), notifyUser: vi.fn(), onChange: vi.fn() };
    return { api, order, deps, upkeep: createTeamUpkeep(deps) };
  };
  const waiting = () => new Map([["v1", [req({ id: "r1", person: "Ann", deviceName: "Air" })]]]);

  it("asks, then seals, and loads the vaults again after asking", async () => {
    const { api, order, deps, upkeep } = setup();
    await upkeep.run(joinTeam(), linked, "/repo");
    expect(order).toEqual(["ask", "seal"]);
    expect(api.requestJoin).toHaveBeenCalledWith({ vaultId: "v1", accountClient: deps.accountClient });
    expect(api.sealTrusted).toHaveBeenCalledWith({ accountClient: deps.accountClient });
    expect(deps.onChange).toHaveBeenCalledWith("/repo");
    expect(deps.notifyUser).not.toHaveBeenCalled();
  });

  it("notifies of new requests only when nothing was sealed, once each", async () => {
    const { deps, upkeep } = setup(0);
    await upkeep.run(idleTeam(waiting()), linked, "/repo");
    expect(deps.notifyUser).toHaveBeenCalledOnce();
    expect(deps.notifyUser).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringMatching(/Ann asks to add Air/) as unknown }));
    expect(deps.onChange).not.toHaveBeenCalled();
    await upkeep.run(idleTeam(waiting()), linked, "/repo");
    expect(deps.notifyUser).toHaveBeenCalledOnce();
  });

  it("doesn't notify when it sealed, and loads the vaults again", async () => {
    const { deps, upkeep } = setup(2);
    await upkeep.run(idleTeam(waiting()), linked, "/repo");
    expect(deps.notifyUser).not.toHaveBeenCalled();
    expect(deps.onChange).toHaveBeenCalledWith("/repo");
  });

  it("doesn't call onChange without a folder", async () => {
    const { deps, upkeep } = setup(1);
    await upkeep.run(joinTeam(), linked, "");
    expect(deps.onChange).not.toHaveBeenCalled();
  });

  it("does nothing without an account client", () => {
    const { deps, upkeep } = setup(0, null);
    expect(upkeep.run(joinTeam(), linked, "/repo")).toBeNull();
    expect(deps.sharedApi).not.toHaveBeenCalled();
  });

  it("doesn't start a second run while one is running", async () => {
    const { deps, upkeep } = setup();
    let release: (v: unknown) => void = () => {};
    const api = { requestJoin: vi.fn(() => Promise.resolve({})), sealTrusted: vi.fn(() => Promise.resolve({ sealed: 0 })) };
    deps.sharedApi.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(api))) as never);
    const first: unknown = upkeep.run(idleTeam(), linked, "/repo");
    const second: unknown = upkeep.run(idleTeam(), linked, "/repo");
    expect(second).toBe(first);
    expect(deps.sharedApi).toHaveBeenCalledOnce();
    release(api);
    await first;
    await upkeep.run(idleTeam(), linked, "/repo");
    expect(deps.sharedApi).toHaveBeenCalledTimes(2);
  });

  it("waits before asking again after a failed ask, then asks once it's due", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers({ now: 0 });
    try {
      const { api, deps, upkeep } = setup();
      api.requestJoin.mockImplementationOnce(() => Promise.reject(new Error("blip")));
      await upkeep.run(joinTeam(), linked, "/repo");
      await upkeep.run(joinTeam(), linked, "/repo");
      expect(api.requestJoin).toHaveBeenCalledOnce();
      expect(deps.onChange).not.toHaveBeenCalled();
      vi.setSystemTime(RETRY_MS);
      await upkeep.run(joinTeam(), linked, "/repo");
      expect(api.requestJoin).toHaveBeenCalledTimes(2);
      expect(deps.onChange).toHaveBeenCalledWith("/repo");
    } finally {
      vi.useRealTimers();
      vi.mocked(console.warn).mockRestore();
    }
  });

  it("swallows an error and runs again afterwards", async () => {
    const { deps, upkeep } = setup();
    deps.sharedApi.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    await expect(upkeep.run(idleTeam(), linked, "/repo")).resolves.toBeNull();
    await upkeep.run(joinTeam(), linked, "/repo");
    expect(deps.onChange).toHaveBeenCalledWith("/repo");
  });
});
