import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({
  RESERVED_SLUGS: new Set(["team"]),
  setCurrentOrg: vi.fn(),
  slugify: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({ serviceClient: vi.fn() }));
vi.mock("@aimhuge/teams", () => teamsMock);
vi.mock("./web-session", () => sessionMock);

import { runCreateTeam, runRenameTeam } from "./team-create";
import type { TeamContext } from "./teams";
import { USER } from "./team-ops.harness";

type Opts = { taken?: string[]; orgError?: string; memberError?: string };
function service({ taken = [], orgError, memberError }: Opts = {}) {
  const deletes: string[] = [];
  const inserts: Record<string, unknown[]> = {};
  const from = vi.fn((table: string) => {
    let slug = "";
    const c: Record<string, unknown> = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn((col: string, v: string) => {
      if (col === "slug") slug = v;
      return c;
    });
    c.maybeSingle = vi.fn(() => Promise.resolve({ data: taken.includes(slug) ? { id: "x" } : null }));
    c.insert = vi.fn((row: unknown) => {
      (inserts[table] ??= []).push(row);
      if (table === "org_memberships") return Promise.resolve({ error: memberError ? { message: memberError } : null });
      return c;
    });
    c.single = vi.fn(() => Promise.resolve(orgError ? { data: null, error: { message: orgError } } : { data: { id: "o9" }, error: null }));
    c.delete = vi.fn(() => {
      deletes.push(table);
      return c;
    });
    return c;
  });
  return { client: { from }, inserts, deletes };
}

beforeEach(() => {
  vi.clearAllMocks();
  teamsMock.slugify.mockImplementation((s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
});

describe("runCreateTeam", () => {
  it("rejects an empty or over-long name", async () => {
    expect((await runCreateTeam(USER, "   ")).ok).toBe(false);
    expect((await runCreateTeam(USER, "x".repeat(61))).ok).toBe(false);
    expect(sessionMock.serviceClient).not.toHaveBeenCalled();
  });

  it("says so when the service client is missing", async () => {
    sessionMock.serviceClient.mockReturnValue(null);
    expect(await runCreateTeam(USER, "Acme")).toEqual({ ok: false, message: "Teams aren't set up on this Weft." });
  });

  it("creates the org, owner membership and current-org pointer", async () => {
    const s = service();
    sessionMock.serviceClient.mockReturnValue(s.client);
    expect(await runCreateTeam(USER, " Acme Co ")).toEqual({ ok: true, message: "Created Acme Co.", slug: "acme-co" });
    expect(s.inserts.orgs).toEqual([{ slug: "acme-co", name: "Acme Co" }]);
    expect(s.inserts.org_memberships).toEqual([{ org_id: "o9", user_id: USER.id, role: "owner" }]);
    expect(teamsMock.setCurrentOrg).toHaveBeenCalledWith(s.client, USER.id, "o9");
  });

  it("adds -2, -3 on a clash and skips reserved and too-short slugs", async () => {
    const s = service({ taken: ["acme", "acme-2"] });
    sessionMock.serviceClient.mockReturnValue(s.client);
    expect((await runCreateTeam(USER, "Acme")).slug).toBe("acme-3");
    expect((await runCreateTeam(USER, "Team")).slug).toBe("team-2");
    expect((await runCreateTeam(USER, "A")).slug).toBe("a-2");
    expect((await runCreateTeam(USER, "!!!")).slug).toBe("workspace");
  });

  it("skips Weft's own root routes, so /<slug>/board never lands on a static page", async () => {
    sessionMock.serviceClient.mockReturnValue(service().client);
    for (const root of ["Privacy", "Terms", "FAQ", "Billing", "Checkout", "Download"]) {
      expect((await runCreateTeam(USER, root)).slug).toBe(`${root.toLowerCase()}-2`);
    }
  });

  it("reports an org insert error", async () => {
    sessionMock.serviceClient.mockReturnValue(service({ orgError: "dup" }).client);
    expect(await runCreateTeam(USER, "Acme")).toEqual({ ok: false, message: "Could not create team: dup" });
  });

  it("rolls the org back when the membership fails", async () => {
    const s = service({ memberError: "nope" });
    sessionMock.serviceClient.mockReturnValue(s.client);
    expect(await runCreateTeam(USER, "Acme")).toEqual({ ok: false, message: "Could not create team: nope" });
    expect(s.deletes).toEqual(["orgs"]);
    expect(teamsMock.setCurrentOrg).not.toHaveBeenCalled();
  });
});

function renameCtx(role: string, error?: string) {
  const eq = vi.fn(() => Promise.resolve({ error: error ? { message: error } : null }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const ctx = { role, org: { id: "o1", slug: "acme", name: "Acme" }, service: { from } } as unknown as TeamContext;
  return { ctx, from, update, eq };
}

describe("runRenameTeam", () => {
  it("renames the org by id, trimmed, and keeps its slug", async () => {
    const r = renameCtx("owner");
    expect(await runRenameTeam(r.ctx, "  Acme Labs ")).toEqual({ ok: true, message: "Renamed to Acme Labs." });
    expect(r.from).toHaveBeenCalledWith("orgs");
    expect(r.update).toHaveBeenCalledWith({ name: "Acme Labs" });
    expect(r.eq).toHaveBeenCalledWith("id", "o1");
  });

  it("is for owners only", async () => {
    for (const role of ["admin", "member"]) {
      const r = renameCtx(role);
      expect(await runRenameTeam(r.ctx, "X")).toEqual({ ok: false, message: "Only an owner can rename the team." });
      expect(r.from).not.toHaveBeenCalled();
    }
  });

  it("rejects an empty or over-long name", async () => {
    const r = renameCtx("owner");
    expect((await runRenameTeam(r.ctx, "  ")).ok).toBe(false);
    expect((await runRenameTeam(r.ctx, "x".repeat(61))).message).toBe("Name the team in 1 to 60 characters.");
    expect(r.from).not.toHaveBeenCalled();
  });

  it("reports an update error", async () => {
    expect(await runRenameTeam(renameCtx("owner", "denied").ctx, "Acme Labs")).toEqual({ ok: false, message: "Could not rename the team: denied" });
  });
});
