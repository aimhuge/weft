import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { runDeleteTeam } from "./team-delete";
import type { TeamContext } from "./teams";

const ACME = { id: "o1", slug: "acme", name: "Acme" };
const OTHER = { id: "o2", slug: "other", name: "Other" };

type Sub = { plan: string; status: string; cancel_at_period_end: boolean } | null;

function ctx({ role = "owner", orgs = [ACME, OTHER], sub = null as Sub, error = null as string | null } = {}) {
  const deleteEq = vi.fn(() => Promise.resolve({ error: error ? { message: error } : null }));
  const del = vi.fn(() => ({ eq: deleteEq }));
  const subEq = vi.fn(() => ({ maybeSingle: () => Promise.resolve({ data: sub }) }));
  const from = vi.fn((table: string) => (table === "orgs" ? { delete: del } : { select: () => ({ eq: subEq }) }));
  const c = { role, org: ACME, orgs, service: { from } } as unknown as TeamContext;
  return { c, from, del, deleteEq, subEq };
}

describe("runDeleteTeam", () => {
  it("deletes the org by id once every check passes", async () => {
    const t = ctx();
    expect(await runDeleteTeam(t.c, " Acme ")).toEqual({ ok: true, message: "Deleted Acme." });
    expect(t.subEq).toHaveBeenCalledWith("org_id", "o1");
    expect(t.del).toHaveBeenCalled();
    expect(t.deleteEq).toHaveBeenCalledWith("id", "o1");
  });

  it("is for owners only", async () => {
    for (const role of ["admin", "member"]) {
      const t = ctx({ role });
      expect(await runDeleteTeam(t.c, "Acme")).toEqual({ ok: false, message: "Only an owner can delete the team." });
      expect(t.from).not.toHaveBeenCalled();
    }
  });

  it("refuses your only team", async () => {
    const t = ctx({ orgs: [ACME] });
    expect((await runDeleteTeam(t.c, "Acme")).message).toBe("You need to be in another team before you can delete this one.");
    expect(t.from).not.toHaveBeenCalled();
  });

  it("needs the team's name typed exactly", async () => {
    const t = ctx();
    expect(await runDeleteTeam(t.c, "acme")).toEqual({ ok: false, message: 'Type "Acme" to delete it.' });
    expect(t.from).not.toHaveBeenCalled();
  });

  it("refuses while a paid plan still bills", async () => {
    const t = ctx({ sub: { plan: "pro", status: "active", cancel_at_period_end: false } });
    expect(await runDeleteTeam(t.c, "Acme")).toEqual({ ok: false, message: "Cancel Acme's pro plan in Billing first." });
    expect(t.del).not.toHaveBeenCalled();
  });

  it("goes ahead on a free, canceled or ending plan", async () => {
    for (const sub of [
      { plan: "free", status: "active", cancel_at_period_end: false },
      { plan: "pro", status: "canceled", cancel_at_period_end: false },
      { plan: "pro", status: "active", cancel_at_period_end: true },
    ]) {
      const t = ctx({ sub });
      expect((await runDeleteTeam(t.c, "Acme")).ok).toBe(true);
    }
  });

  it("goes ahead on a granted $0 plan, which bills nothing", async () => {
    for (const plan of ["oss", "edu"]) {
      const t = ctx({ sub: { plan, status: "active", cancel_at_period_end: false } });
      expect((await runDeleteTeam(t.c, "Acme")).ok).toBe(true);
      expect(t.del).toHaveBeenCalled();
    }
  });

  it("reports a delete error", async () => {
    expect(await runDeleteTeam(ctx({ error: "fk" }).c, "Acme")).toEqual({ ok: false, message: "Could not delete the team: fk" });
  });
});
