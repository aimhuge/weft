import { beforeEach, describe, expect, it, vi } from "vitest";

const teamsMock = vi.hoisted(() => ({ roleCan: vi.fn() }));
vi.mock("@aimhuge/teams", () => teamsMock);
const projectsMock = vi.hoisted(() => ({ listTeamProjects: vi.fn() }));
vi.mock("./team-projects", () => projectsMock);

import { listVisibleProjects, runSetProjectAccess } from "./team-project-access";
import { ORG, USER } from "./team-ops.harness";

// A thenable chain: the last call in a query resolves to `result`.
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "maybeSingle", "upsert", "delete"]) c[m] = vi.fn(() => c);
  Object.defineProperty(c, "then", { value: (r: (v: unknown) => void) => Promise.resolve(result).then(r) });
  return c;
}
function ctxWith(results: unknown[], role: "owner" | "admin" | "member" = "owner") {
  const chains = results.map(chain);
  const used: Record<string, unknown>[] = [];
  const from = vi.fn(() => {
    const c = chains.shift() ?? chain({ data: null, error: null });
    used.push(c);
    return c;
  });
  return { ctx: { user: USER, org: ORG, role, orgs: [ORG], service: { from } as never }, from, used };
}

const A = { repo: "a/one", addedAt: "t1", addedBy: null };
const B = { repo: "b/two", addedAt: "t2", addedBy: "u9" };

beforeEach(() => {
  vi.clearAllMocks();
  teamsMock.roleCan.mockImplementation((role: string) => role !== "member");
  projectsMock.listTeamProjects.mockResolvedValue([A, B]);
});

describe("listVisibleProjects", () => {
  it("gives those who manage every project with its grants", async () => {
    const { ctx } = ctxWith([{ data: [{ repo: "a/one", user_id: "m1" }, { repo: "a/one", user_id: "m2" }] }]);
    expect(await listVisibleProjects(ctx)).toEqual([
      { ...A, access: ["m1", "m2"] },
      { ...B, access: [] },
    ]);
  });

  it("gives a member only their granted projects, without who else is on them", async () => {
    const { ctx } = ctxWith([{ data: [{ repo: "b/two", user_id: USER.id }, { repo: "b/two", user_id: "m2" }, { repo: "a/one", user_id: "m2" }] }], "member");
    expect(await listVisibleProjects(ctx)).toEqual([{ ...B, access: [] }]);
  });

  it("shows a member nothing when the grants can't be read", async () => {
    const { ctx } = ctxWith([{ data: null }], "member");
    expect(await listVisibleProjects(ctx)).toEqual([]);
  });
});

describe("runSetProjectAccess", () => {
  it("refuses members, bad repos and a missing member id before touching the database", async () => {
    const member = ctxWith([], "member");
    expect(await runSetProjectAccess(member.ctx, "a/one", "m1", true)).toEqual({ ok: false, message: "You don't have permission to change project access." });
    expect(member.from).not.toHaveBeenCalled();
    expect((await runSetProjectAccess(ctxWith([]).ctx, "nope", "m1", true)).message).toBe("Use the owner/name form, like acme/site.");
    expect((await runSetProjectAccess(ctxWith([]).ctx, "a/one", "", true)).message).toBe("Missing member id.");
  });

  it("grants a member access to a linked project, idempotently", async () => {
    const { ctx, used } = ctxWith([{ data: { repo: "a/one" } }, { data: { role: "member" } }, { error: null }], "admin");
    expect(await runSetProjectAccess(ctx, " a/one ", "m1", true)).toEqual({ ok: true, message: "Granted access to a/one." });
    expect(used[2]?.upsert).toHaveBeenCalledWith(
      { org_id: ORG.id, repo: "a/one", user_id: "m1", granted_by: USER.id },
      { onConflict: "org_id,repo,user_id", ignoreDuplicates: true },
    );
  });

  it("refuses an unlinked project, a non-member and an owner or admin", async () => {
    expect((await runSetProjectAccess(ctxWith([{ data: null }, { data: { role: "member" } }]).ctx, "a/one", "m1", true)).message).toBe(
      "That project isn't linked to this team.",
    );
    expect((await runSetProjectAccess(ctxWith([{ data: { repo: "a/one" } }, { data: null }]).ctx, "a/one", "m1", true)).message).toBe(
      "That person isn't a member of this workspace.",
    );
    expect((await runSetProjectAccess(ctxWith([{ data: { repo: "a/one" } }, { data: { role: "admin" } }]).ctx, "a/one", "m1", true)).message).toBe(
      "Owners and admins see every project already.",
    );
  });

  it("reports a grant that fails to write", async () => {
    const { ctx } = ctxWith([{ data: { repo: "a/one" } }, { data: { role: "member" } }, { error: { message: "boom" } }]);
    expect(await runSetProjectAccess(ctx, "a/one", "m1", true)).toEqual({ ok: false, message: "Could not grant access: boom" });
  });

  it("takes access away without the link or role checks", async () => {
    const { ctx, from, used } = ctxWith([{ error: null }]);
    expect(await runSetProjectAccess(ctx, "a/one", "m1", false)).toEqual({ ok: true, message: "Removed access to a/one." });
    expect(from).toHaveBeenCalledTimes(1);
    expect(used[0]?.delete).toHaveBeenCalled();
  });

  it("reports a revoke that fails", async () => {
    const { ctx } = ctxWith([{ error: { message: "nope" } }]);
    expect(await runSetProjectAccess(ctx, "a/one", "m1", false)).toEqual({ ok: false, message: "Could not remove access: nope" });
  });
});
