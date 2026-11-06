// @vitest-environment happy-dom
import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMock, jsonResponse, stubTeamFetch, team } from "./use-team.harness";
import { TEAM_ORG_KEY } from "./team-view";
import {
  TEAM_CACHE_KEY,
  cachedTeam,
  clearTeamCache,
  fetchTeam,
  hydrateTeamCache,
  loadTeam,
  prefetchTeam,
  prefetchTeams,
  warmTeams,
} from "./team-cache";

stubTeamFetch(clearTeamCache);
beforeEach(() => window.localStorage.clear());

const disk = () => JSON.parse(window.localStorage.getItem(TEAM_CACHE_KEY) ?? "null") as Record<string, unknown> | null;
const urls = () => fetchMock.mock.calls.map(([url]) => url as string);

describe("fetchTeam", () => {
  it("maps each status to a state", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    expect(await fetchTeam(undefined)).toEqual({ kind: "signed-out" });
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    expect(await fetchTeam("x")).toEqual({ kind: "error", message: "No workspace found." });
    fetchMock.mockResolvedValueOnce(jsonResponse(502, {}));
    expect(await fetchTeam("x")).toEqual({ kind: "error", message: "Couldn't reach weft.zip." });
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: "boom" }));
    expect(await fetchTeam("x")).toEqual({ kind: "error", message: "boom" });
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    expect(await fetchTeam("x")).toEqual({ kind: "error", message: "Weft's team API answered 500." });
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 500 }));
    expect(await fetchTeam("x")).toEqual({ kind: "error", message: "Weft's team API answered 500." });
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await fetchTeam("x")).toEqual({ kind: "error", message: "Couldn't reach weft.zip." });
    expect(urls()[1]).toBe("/api/account/team?org=x");
  });
});

describe("the disk copy", () => {
  it("keeps good answers per workspace, keeps them through an error and drops them on a signed-out answer", async () => {
    await loadTeam("acme", false);
    await loadTeam(undefined, false);
    expect(Object.keys(disk() ?? {})).toEqual(["acme", ""]);
    fetchMock.mockResolvedValueOnce(jsonResponse(502, {}));
    await loadTeam("acme", true);
    expect(Object.keys(disk() ?? {})).toEqual(["acme", ""]);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await loadTeam(undefined, true);
    expect(disk()).toBeNull();
  });

  it("brings this account's snapshots back into memory and drops another account's", () => {
    const other = { ...team, user: { ...team.user, id: "u2" } };
    window.localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify({ acme: team, beta: other }));
    hydrateTeamCache("u1");
    expect(cachedTeam("acme")).toEqual({ kind: "ok", team });
    expect(cachedTeam("beta")).toBeUndefined();
    expect(Object.keys(disk() ?? {})).toEqual(["acme"]);
    hydrateTeamCache("u1");
    expect(cachedTeam("acme")).toEqual({ kind: "ok", team });
    hydrateTeamCache("u3");
    expect(cachedTeam("acme")).toEqual({ kind: "ok", team });
    expect(disk()).toBeNull();
  });

  it("survives unreadable or unwritable storage", async () => {
    window.localStorage.setItem(TEAM_CACHE_KEY, "{not json");
    expect(() => hydrateTeamCache("u1")).not.toThrow();
    window.localStorage.setItem(TEAM_CACHE_KEY, "7");
    expect(() => hydrateTeamCache("u1")).not.toThrow();
    const full = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    await expect(loadTeam("acme", false)).resolves.toMatchObject({ kind: "ok" });
    full.mockRestore();
  });

  it("clearTeamCache(false) forgets memory only", async () => {
    await loadTeam("acme", false);
    clearTeamCache(false);
    expect(cachedTeam("acme")).toBeUndefined();
    expect(disk()).not.toBeNull();
    clearTeamCache();
    expect(disk()).toBeNull();
  });
});

describe("loadTeam", () => {
  it("joins a load on its way, unless fresh, and prefetchTeam waits for one on its way", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, team)));
    const first = loadTeam(undefined, false);
    expect(loadTeam(undefined, false)).toBe(first);
    prefetchTeam();
    const fresh = loadTeam(undefined, true);
    expect(fresh).not.toBe(first);
    await Promise.all([first, fresh]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cachedTeam(undefined)).toEqual({ kind: "ok", team });
  });

  it("skips an empty entry on disk", () => {
    window.localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify({ acme: null, beta: {} }));
    hydrateTeamCache("u1");
    expect(cachedTeam("acme")).toBeUndefined();
  });
});

describe("warming", () => {
  it("warmTeams loads the default and the last-picked workspace, opening on the disk copy meanwhile", async () => {
    window.localStorage.setItem(TEAM_ORG_KEY, "exiting");
    window.localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify({ exiting: team }));
    warmTeams("u1");
    expect(cachedTeam("exiting")).toEqual({ kind: "ok", team });
    await waitFor(() => expect(urls()).toEqual(["/api/account/team", "/api/account/team?org=exiting"]));
  });

  it("warmTeams without a pick loads only the default", async () => {
    warmTeams("u1");
    await waitFor(() => expect(urls()).toEqual(["/api/account/team"]));
  });

  it("prefetchTeams warms each listed workspace once, up to six", async () => {
    prefetchTeams(["a", "b", "c", "d", "e", "f", "g"]);
    prefetchTeams(["a"]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    await new Promise((r) => setTimeout(r, 0));
    prefetchTeam("a");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
