import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ loadTeam: vi.fn(), people: vi.fn() }));

vi.mock("./team-cache", () => ({ loadTeam: h.loadTeam }));
vi.mock("./share-grant-client", () => ({ grantApi: { people: h.people } }));

import { localSearchPeople, preloadPeople, teamPeople } from "./people-search";
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

  it("hands the local people over before GitHub answers", async () => {
    h.loadTeam.mockResolvedValue(ok([{ login: "kim" }]));
    let answer: (v: unknown) => void = () => {};
    h.people.mockImplementation((q: string) => (q ? new Promise((r) => (answer = r)) : Promise.resolve([])));
    const onLocal = vi.fn();
    const out = localSearchPeople("card-4", "ki", onLocal);
    await vi.waitFor(() => expect(onLocal).toHaveBeenCalledWith([expect.objectContaining({ login: "kim" })]));
    answer([hit("kimberly", "github")]);
    expect((await out).map((p) => p.login)).toEqual(["kim", "kimberly"]);
  });

  it("keeps GitHub's answer per query and says nothing early when no one local matches", async () => {
    h.loadTeam.mockResolvedValue(ok([]));
    h.people.mockResolvedValue([hit("qq", "github")]);
    const onLocal = vi.fn();
    await localSearchPeople(undefined, "QQ", onLocal);
    await localSearchPeople(undefined, "qq");
    expect(h.people).toHaveBeenCalledTimes(1);
    expect(onLocal).not.toHaveBeenCalled();
  });
});

describe("preloadPeople", () => {
  it("warms the team and the card's repo people", () => {
    h.loadTeam.mockRejectedValue(new Error("offline"));
    h.people.mockResolvedValue([]);
    preloadPeople("card-5");
    preloadPeople(undefined);
    expect(h.loadTeam).toHaveBeenCalledTimes(2);
    expect(h.people).toHaveBeenCalledTimes(1);
  });
});
