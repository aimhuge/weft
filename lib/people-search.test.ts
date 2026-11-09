import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ loadTeam: vi.fn(), people: vi.fn() }));

vi.mock("./team-cache", () => ({ loadTeam: h.loadTeam }));
vi.mock("./share-grant-client", () => ({ grantApi: { people: h.people } }));

import { localSearchPeople, teamPeople } from "./people-search";
import type { TeamLoadState } from "./team-cache";

const ok = (members: { login?: string | null; name?: string | null }[]) => ({ kind: "ok", team: { members } }) as unknown as TeamLoadState;
const hit = (login: string, kind: "repo" | "github") => ({ login, name: null, avatarUrl: null, kind });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("teamPeople", () => {
  it("is empty until the team has loaded", () => {
    expect(teamPeople(undefined)).toEqual([]);
    expect(teamPeople({ kind: "signed-out" })).toEqual([]);
    expect(teamPeople({ kind: "error", message: "x" })).toEqual([]);
  });

  it("offers members who signed in with GitHub", () => {
    expect(teamPeople(ok([{ login: "ann", name: "Ann" }, { login: "bob" }, { login: "" }, { login: null }, { name: "No Login" }]))).toEqual([
      { login: "ann", name: "Ann", avatarUrl: null, kind: "team" },
      { login: "bob", name: null, avatarUrl: null, kind: "team" },
    ]);
  });
});

describe("localSearchPeople", () => {
  it("merges the team, the card's repo people and GitHub's hits", async () => {
    h.loadTeam.mockResolvedValue(ok([{ login: "ann" }]));
    h.people.mockImplementation((q: string) => Promise.resolve(q ? [hit("annette", "github")] : [hit("anders", "repo")]));
    const out = await localSearchPeople("card-1", " an ");
    expect(out.map((p) => p.login)).toEqual(["ann", "anders", "annette"]);
    expect(h.loadTeam).toHaveBeenCalledWith(undefined, false);
    expect(h.people).toHaveBeenCalledWith("", "card-1");
    expect(h.people).toHaveBeenCalledWith("an");
  });

  it("asks for a card's repo people once per session", async () => {
    h.loadTeam.mockResolvedValue(ok([]));
    h.people.mockResolvedValue([hit("rex", "repo")]);
    await localSearchPeople("card-2", "");
    await localSearchPeople("card-2", "");
    expect(h.people).toHaveBeenCalledTimes(1);
  });

  it("asks GitHub nothing for an empty query and no repo for no card", async () => {
    h.loadTeam.mockResolvedValue(ok([{ login: "ann" }]));
    expect((await localSearchPeople(undefined, "  ")).map((p) => p.login)).toEqual(["ann"]);
    expect(h.people).not.toHaveBeenCalled();
  });

  it("falls back to no one when each source fails", async () => {
    h.loadTeam.mockRejectedValue(new Error("offline"));
    h.people.mockRejectedValue(new Error("403"));
    expect(await localSearchPeople("card-3", "zed")).toEqual([]);
  });
});
