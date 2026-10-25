// /api/teams on weft.zip: bearer-token auth, no localhost guard. The
// bearer path is mocked at the @/lib/web-session boundary; team-ops
// (teamSnapshot, runTeamOp) are also mocked because the deep behavior
// already has lib/team-ops.test.ts. What these tests pin is the wire:
// which errors come back (signed-out / not-found / unconfigured /
// bad-request), how the body is parsed, and that the right calls go
// into team-ops with the right org.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));

const bearerUser = vi.hoisted(() => vi.fn());
const teamAccessFor = vi.hoisted(() => vi.fn());
const currentWorkspaceFor = vi.hoisted(() => vi.fn());
const teamSnapshot = vi.hoisted(() => vi.fn());
const runTeamOp = vi.hoisted(() => vi.fn());
// A mutable "env" read through a getter: the route checks SUPABASE_KEY at
// request time, so the test can flip it off to assert 503.
const supabaseKey = vi.hoisted(() => ({ value: "sb_test" }));

vi.mock("@/lib/web-session", () => ({ bearerUser }));
vi.mock("@/lib/teams", () => ({ currentWorkspaceFor, teamAccessFor }));
const runCreateTeam = vi.hoisted(() => vi.fn());
vi.mock("@/lib/team-ops", () => ({ teamSnapshot, runTeamOp }));
vi.mock("@/lib/team-create", () => ({ runCreateTeam }));
vi.mock("@/lib/supabase-project", () => ({
  get SUPABASE_KEY() {
    return supabaseKey.value;
  },
}));

const route = await import("./route");

const USER = { id: "u1", email: "jane@example.com", name: "Jane", avatar: null };
const ORG = { id: "o1", slug: "acme", name: "Acme" };
const CTX = { user: USER, org: ORG, role: "owner" as const, orgs: [ORG], service: {} as never };
const SNAPSHOT = { user: USER, org: ORG, role: "owner", orgs: [ORG], canManage: true, members: [], pending: [], projects: [], roleOptions: [], roleLabels: { owner: "Owner", admin: "Admin", member: "Member" } };

function req({ method = "GET", org, body, auth = "Bearer jwt.tok.en" }: { method?: string; org?: string; body?: unknown; auth?: string | null } = {}) {
  const url = `https://weft.example/api/teams${org ? `?org=${org}` : ""}`;
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  bearerUser.mockResolvedValue(USER);
  teamAccessFor.mockResolvedValue({ kind: "ok", ctx: CTX });
  currentWorkspaceFor.mockResolvedValue({ kind: "ok", slug: "acme" });
  teamSnapshot.mockResolvedValue(SNAPSHOT);
  runTeamOp.mockResolvedValue({ ok: true, message: "ok" });
  supabaseKey.value = "sb_test";
});

describe("GET /api/teams", () => {
  it("returns the snapshot for the named org", async () => {
    const res = await route.GET(req({ org: "acme" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SNAPSHOT);
    expect(bearerUser).toHaveBeenCalledTimes(1);
    expect(teamAccessFor).toHaveBeenCalledWith(USER, "acme");
    expect(currentWorkspaceFor).not.toHaveBeenCalled();
  });

  it("defaults to the user's current workspace when ?org is omitted", async () => {
    const res = await route.GET(req());
    expect(res.status).toBe(200);
    expect(currentWorkspaceFor).toHaveBeenCalledWith(USER);
    expect(teamAccessFor).toHaveBeenCalledWith(USER, "acme");
  });

  it("is 401 signed-out when the bearer is missing or invalid", async () => {
    bearerUser.mockResolvedValueOnce(null);
    const res = await route.GET(req({ auth: "Bearer bad" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed-out" });
    expect(teamAccessFor).not.toHaveBeenCalled();
  });

  it("is 401 signed-out when the Authorization header is missing", async () => {
    bearerUser.mockResolvedValueOnce(null);
    const res = await route.GET(req({ auth: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed-out" });
  });

  it("is 404 not-found for a non-member or missing org", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "denied" });
    const res = await route.GET(req({ org: "acme" }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
  });

  it("is 401 signed-out when the user has no current workspace and ?org is omitted", async () => {
    currentWorkspaceFor.mockResolvedValueOnce({ kind: "none" });
    const res = await route.GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed-out" });
    expect(teamAccessFor).not.toHaveBeenCalled();
  });

  it("is 503 unconfigured when SUPABASE_KEY is missing", async () => {
    supabaseKey.value = "";
    const res = await route.GET(req({ org: "acme" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unconfigured" });
  });

  it("exports no route segment config, which cacheComponents refuses at build", () => {
    expect("dynamic" in route).toBe(false);
  });
});

describe("POST /api/teams", () => {
  it("delegates a well-formed TeamOp to runTeamOp and returns its result", async () => {
    const op = { org: "acme", action: "invite", email: "x@y.com", role: "member" };
    const res = await route.POST(req({ method: "POST", body: op }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, message: "ok" });
    expect(runTeamOp).toHaveBeenCalledWith(CTX, op);
  });

  it("takes the org from the body, not the query string", async () => {
    const op = { org: "acme", action: "remove", userId: "u2" };
    await route.POST(req({ method: "POST", body: op, org: "other" }));
    expect(teamAccessFor).toHaveBeenCalledWith(USER, "acme");
    expect(runTeamOp).toHaveBeenCalledWith(CTX, op);
  });

  it.each([
    { label: "missing body", body: undefined },
    { label: "non-JSON body", body: "{" },
    { label: "empty object", body: {} },
    { label: "missing org", body: { action: "invite", email: "x@y.com", role: "member" } },
    { label: "unknown action", body: { org: "acme", action: "banana" } },
    { label: "missing email for invite", body: { org: "acme", action: "invite", role: "member" } },
    { label: "missing role for invite", body: { org: "acme", action: "invite", email: "x@y.com" } },
    { label: "bad role", body: { org: "acme", action: "invite", email: "x@y.com", role: "superuser" } },
    { label: "missing userId for remove", body: { org: "acme", action: "remove" } },
    { label: "missing userId for role", body: { org: "acme", action: "role", role: "admin" } },
    { label: "bad role for role action", body: { org: "acme", action: "role", userId: "u2", role: "superuser" } },
    { label: "missing inviteId for revoke", body: { org: "acme", action: "revoke" } },
  ])("is 400 bad-request for $label", async ({ body }) => {
    const res = await route.POST(req({ method: "POST", body }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-request" });
    expect(teamAccessFor).not.toHaveBeenCalled();
    expect(runTeamOp).not.toHaveBeenCalled();
  });

  it("is 401 signed-out when the bearer is missing or invalid", async () => {
    bearerUser.mockResolvedValueOnce(null);
    const op = { org: "acme", action: "invite", email: "x@y.com", role: "member" };
    const res = await route.POST(req({ method: "POST", body: op, auth: "Bearer bad" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed-out" });
    expect(runTeamOp).not.toHaveBeenCalled();
  });

  it("is 404 not-found when the actor isn't a member of the org in the body", async () => {
    teamAccessFor.mockResolvedValueOnce({ kind: "denied" });
    const op = { org: "acme", action: "invite", email: "x@y.com", role: "member" };
    const res = await route.POST(req({ method: "POST", body: op }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not-found" });
    expect(runTeamOp).not.toHaveBeenCalled();
  });

  it("is 503 unconfigured when SUPABASE_KEY is missing", async () => {
    supabaseKey.value = "";
    const op = { org: "acme", action: "invite", email: "x@y.com", role: "member" };
    const res = await route.POST(req({ method: "POST", body: op }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unconfigured" });
  });
});
describe("POST /api/teams project and create ops", () => {
  it("runs link-project and unlink-project against the body's org", async () => {
    for (const action of ["link-project", "unlink-project"]) {
      const op = { org: "acme", action, repo: "a/b" };
      const res = await route.POST(req({ method: "POST", body: op }));
      expect(res.status).toBe(200);
      expect(runTeamOp).toHaveBeenLastCalledWith(CTX, op);
    }
  });

  it("runs project-access, and 400s when grant isn't a boolean", async () => {
    const op = { org: "acme", action: "project-access", repo: "a/b", userId: "u2", grant: false };
    expect((await route.POST(req({ method: "POST", body: op }))).status).toBe(200);
    expect(runTeamOp).toHaveBeenLastCalledWith(CTX, op);
    expect((await route.POST(req({ method: "POST", body: { ...op, grant: "yes" } }))).status).toBe(400);
  });

  it("runs rename against the body's org, and 400s without a name", async () => {
    const op = { org: "acme", action: "rename", name: "Acme Labs" };
    expect((await route.POST(req({ method: "POST", body: op }))).status).toBe(200);
    expect(runTeamOp).toHaveBeenLastCalledWith(CTX, op);
    expect((await route.POST(req({ method: "POST", body: { org: "acme", action: "rename" } }))).status).toBe(400);
  });

  it("runs delete against the body's org, and 400s without the typed name", async () => {
    const op = { org: "acme", action: "delete", confirm: "Acme" };
    expect((await route.POST(req({ method: "POST", body: op }))).status).toBe(200);
    expect(runTeamOp).toHaveBeenLastCalledWith(CTX, op);
    expect((await route.POST(req({ method: "POST", body: { org: "acme", action: "delete" } }))).status).toBe(400);
  });

  it("creates a team with the bearer user alone, no org gate", async () => {
    runCreateTeam.mockResolvedValue({ ok: true, message: "Created", slug: "new" });
    const res = await route.POST(req({ method: "POST", body: { action: "create", name: "New" } }));
    expect(await res.json()).toEqual({ ok: true, message: "Created", slug: "new" });
    expect(runCreateTeam).toHaveBeenCalledWith(USER, "New");
    expect(teamAccessFor).not.toHaveBeenCalled();
  });

  it("create is 401 when signed out, 503 unconfigured, 400 without a name", async () => {
    bearerUser.mockResolvedValueOnce(null);
    expect((await route.POST(req({ method: "POST", body: { action: "create", name: "N" } }))).status).toBe(401);
    expect((await route.POST(req({ method: "POST", body: { action: "create" } }))).status).toBe(400);
    supabaseKey.value = "";
    expect((await route.POST(req({ method: "POST", body: { action: "create", name: "N" } }))).status).toBe(503);
    expect(runCreateTeam).not.toHaveBeenCalled();
  });
});
