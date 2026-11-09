import { describe, expect, it } from "vitest";
import type { PersonHit, ShareGrant } from "./share-grant-types";
import { agoText, grantStatus, mergePeople, PEOPLE_LIMIT, pickHint } from "./share-people";

const p = (login: string, kind: PersonHit["kind"], name: string | null = null): PersonHit => ({ login, name, avatarUrl: null, kind });
const logins = (hits: PersonHit[]) => hits.map((h) => h.login);

describe("mergePeople", () => {
  it("puts the team first, then the repo, then GitHub, each login once", () => {
    const out = mergePeople("", { team: [p("Tia", "team")], suggested: [p("rex", "repo"), p("tia", "repo")], found: [p("REX", "github"), p("gus", "github")] });
    expect(logins(out)).toEqual(["Tia", "rex", "gus"]);
  });

  it("filters local people by login or name and ranks a prefix match first", () => {
    const out = mergePeople("@Al", { team: [p("sal", "team"), p("zed", "team", "Alma Z"), p("nobody", "team")], suggested: [p("alex", "repo")] });
    expect(logins(out)).toEqual(["alex", "sal", "zed"]);
  });

  it("treats a missing name as no match and keeps GitHub hits unfiltered", () => {
    expect(logins(mergePeople("q", { team: [p("abc", "team")], found: [p("zzz", "github")] }))).toEqual(["zzz"]);
  });

  it("works with no groups at all", () => {
    expect(mergePeople("x", {})).toEqual([]);
  });

  it("stops at the limit", () => {
    const found = Array.from({ length: 12 }, (_, i) => p(`u${i}`, "github"));
    expect(mergePeople("", { found })).toHaveLength(PEOPLE_LIMIT);
    expect(logins(mergePeople("", { found }, 2))).toEqual(["u0", "u1"]);
  });
});

describe("agoText", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  const before = (ms: number) => new Date(now - ms).toISOString();

  it("reads seconds as just now, and a future time too", () => {
    expect(agoText(before(30_000), now)).toBe("just now");
    expect(agoText(before(-60_000), now)).toBe("just now");
  });

  it("reads minutes, hours and days", () => {
    expect(agoText(before(5 * 60_000), now)).toBe("5m ago");
    expect(agoText(before(3 * 3_600_000), now)).toBe("3h ago");
    expect(agoText(before(2 * 86_400_000), now)).toBe("2d ago");
  });

  it("defaults now to the clock", () => {
    expect(agoText(new Date().toISOString())).toBe("just now");
  });
});

describe("grantStatus", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  const g = (over: Partial<ShareGrant> = {}): ShareGrant => ({ githubId: 1, login: "a", via: "share", createdAt: "2026-11-09T00:00:00Z", notifiedAt: null, openedAt: null, ...over });

  it("says opened once they got in", () => {
    expect(grantStatus(g({ openedAt: new Date(now - 120_000).toISOString() }), undefined, now)).toEqual({ text: "opened 2m ago", tone: "ok" });
  });

  it("says emailed from the stamp or this session's notice", () => {
    expect(grantStatus(g({ notifiedAt: "2026-11-09T01:00:00Z" }))).toEqual({ text: "emailed", tone: "muted" });
    expect(grantStatus(g(), "emailed")).toEqual({ text: "emailed", tone: "muted" });
  });

  it("warns when the email couldn't go or no address is known", () => {
    expect(grantStatus(g(), "not-sent")).toEqual({ text: "couldn't email · send them the link", tone: "warn" });
    expect(grantStatus(g(), "no-email")).toEqual({ text: "no email on file · send them the link", tone: "warn" });
    expect(grantStatus(g())).toEqual({ text: "no email on file · send them the link", tone: "warn" });
  });
});

describe("pickHint", () => {
  it("names where each person comes from", () => {
    expect(pickHint(p("a", "team"), true)).toBe("in your workspace");
    expect(pickHint(p("a", "repo"), false)).toBe("on this repo");
    expect(pickHint(p("a", "github"), false)).toBe("GitHub");
    expect(pickHint(p("a", "repo"), true)).toBe("on this repo · can get access to the share");
    expect(pickHint(p("a", "github"), true)).toBe("GitHub · can get access to the share");
  });
});
