import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebUser } from "@/lib/web-session";

// The share-by-GitHub routes (docs/architecture/sharing.md#people): the board's /api/cards/[id]/share/grants and
// /api/github/users behind the localhost guard (writes need x-weft-token), and weft.zip's /api/s/[id]/grants/notify
// on the owner's bearer token.

vi.mock("@/lib/shell-token", () => ({ shellToken: () => "" }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/card-share", () => {
  class CardShareError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }
  return { CardShareError };
});
vi.mock("@/lib/card-share-grants", () => ({
  listShareGrants: vi.fn(() => Promise.resolve({ shareId: "s1", grants: [] })),
  grantShare: vi.fn(() => Promise.resolve([{ login: "octo", ok: false, error: "x" }])),
  revokeShareGrant: vi.fn(() => Promise.resolve({ shareId: "s1", grants: [] })),
}));
vi.mock("@/lib/github-users", () => ({
  searchGithubUsers: vi.fn(() => Promise.resolve([{ login: "octo", name: null, avatarUrl: null, kind: "github" }])),
  suggestPeople: vi.fn(() => Promise.resolve([{ login: "ada", name: null, avatarUrl: null, kind: "repo" }])),
}));
vi.mock("@/lib/store", () => ({ getCard: vi.fn((id: string) => (id === "c1" ? { id: "c1", cwd: "/w" } : undefined)) }));
const bearerUser = vi.fn<(req: Request) => Promise<WebUser | null>>(() => Promise.resolve({ id: "u1", email: null, name: null, avatar: null }));
const serviceClient = vi.fn<() => object | null>(() => ({ kind: "service" }));
vi.mock("@/lib/web-session", () => ({ bearerUser, serviceClient }));
const notifyGrant = vi.fn<(...args: unknown[]) => Promise<{ status: number; json: object }>>(() => Promise.resolve({ status: 200, json: { notice: "emailed" } }));
vi.mock("@/lib/share-grant-notify", () => ({ notifyGrant, resendSender: () => "send", githubPublicEmail: () => "lookup" }));

const share = await import("@/lib/card-share");
const lib = await import("@/lib/card-share-grants");
const people = await import("@/lib/github-users");
const grants = await import("./cards/[id]/share/grants/route");
const users = await import("./github/users/route");
const notify = await import("./s/[id]/grants/notify/route");

const URL = "http://localhost:3457/api/cards/c1/share/grants";
const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };
const params = { params: Promise.resolve({ id: "c1" }) };
const post = (body: string, headers: Record<string, string> = WRITE) => grants.POST(new Request(URL, { method: "POST", headers, body }), params);
const del = (q: string, headers: Record<string, string> = WRITE) => grants.DELETE(new Request(`${URL}${q}`, { method: "DELETE", headers }), params);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cards/[id]/share/grants", () => {
  it("lists the card's people", async () => {
    const res = await grants.GET(new Request(URL, { headers: READ }), params);
    expect(await res.json()).toEqual({ shareId: "s1", grants: [] });
    expect(lib.listShareGrants).toHaveBeenLastCalledWith("c1");
  });

  it("refuses other hosts and turns errors into their status", async () => {
    expect((await grants.GET(new Request("http://evil.test/x", { headers: { host: "evil.test" } }), params)).status).toBe(403);
    vi.mocked(lib.listShareGrants).mockRejectedValueOnce(new share.CardShareError("Share this card first.", 409));
    expect((await grants.GET(new Request(URL, { headers: READ }), params)).status).toBe(409);
    vi.mocked(lib.listShareGrants).mockRejectedValueOnce(new Error("down"));
    expect((await grants.GET(new Request(URL, { headers: READ }), params)).status).toBe(500);
  });
});

describe("POST /api/cards/[id]/share/grants", () => {
  it("grants the logins, as a share unless it's a mention", async () => {
    const res = await post(JSON.stringify({ logins: ["octo"], via: "share", note: 7 }));
    expect(await res.json()).toEqual([{ login: "octo", ok: false, error: "x" }]);
    expect(lib.grantShare).toHaveBeenLastCalledWith("c1", { logins: ["octo"], via: "share", note: undefined });
    await post(JSON.stringify({ logins: ["octo"], via: "mention", note: "look" }));
    expect(lib.grantShare).toHaveBeenLastCalledWith("c1", { logins: ["octo"], via: "mention", note: "look" });
    await post(JSON.stringify({ logins: ["octo"], via: "whatever" }));
    expect(lib.grantShare).toHaveBeenLastCalledWith("c1", { logins: ["octo"], via: "share", note: undefined });
  });

  it("needs the write header and a JSON object", async () => {
    expect((await post("{}", READ)).status).toBe(403);
    const bad = await post("not json");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Send { logins, via, note? }." });
    expect((await post("3")).status).toBe(400);
  });

  it("passes a refusal's status through", async () => {
    vi.mocked(lib.grantShare).mockRejectedValueOnce(new share.CardShareError("Name a GitHub user.", 400));
    const res = await post(JSON.stringify({ logins: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name a GitHub user." });
  });
});

describe("DELETE /api/cards/[id]/share/grants", () => {
  it("removes the person by GitHub id", async () => {
    expect(await (await del("?github=101")).json()).toEqual({ shareId: "s1", grants: [] });
    expect(lib.revokeShareGrant).toHaveBeenLastCalledWith("c1", 101);
  });

  it("needs the write header and passes refusals through", async () => {
    expect((await del("?github=1", READ)).status).toBe(403);
    vi.mocked(lib.revokeShareGrant).mockRejectedValueOnce(new share.CardShareError("Unknown person.", 400));
    expect((await del("")).status).toBe(400);
  });
});

describe("GET /api/github/users", () => {
  const get = (q: string, headers: Record<string, string> = READ) => users.GET(new Request(`http://localhost:3457/api/github/users${q}`, { headers }));

  it("searches GitHub for a query", async () => {
    expect(await (await get("?q=%20octo%20")).json()).toEqual({ people: [expect.objectContaining({ login: "octo" })] });
    expect(people.searchGithubUsers).toHaveBeenLastCalledWith("octo");
  });

  it("suggests the card's repo people, or none for an unknown card", async () => {
    expect(await (await get("?card=c1")).json()).toEqual({ people: [expect.objectContaining({ login: "ada" })] });
    expect(people.suggestPeople).toHaveBeenLastCalledWith("/w");
    expect(await (await get("?card=nope")).json()).toEqual({ people: [] });
    expect(await (await get("")).json()).toEqual({ people: [] });
  });

  it("refuses other hosts and answers errors with a 400", async () => {
    expect((await users.GET(new Request("http://evil.test/api/github/users", { headers: { host: "evil.test" } }))).status).toBe(403);
    vi.mocked(people.searchGithubUsers).mockRejectedValueOnce(new Error("gh down"));
    expect((await get("?q=octo")).status).toBe(400);
  });
});

describe("POST /api/s/[id]/grants/notify", () => {
  const ctx = { params: Promise.resolve({ id: "abcdefghijklmnop" }) };
  const call = (body: string, url = "http://localhost:3000/api/s/abcdefghijklmnop/grants/notify") =>
    notify.POST(new Request(url, { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body }), ctx);

  it("is a 401 without a signed-in bearer", async () => {
    bearerUser.mockResolvedValueOnce(null);
    const res = await call("{}");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "signed-out" });
  });

  it("answers not-sent with no service client", async () => {
    serviceClient.mockReturnValueOnce(null);
    expect(await (await call("{}")).json()).toEqual({ notice: "not-sent" });
    expect(notifyGrant).not.toHaveBeenCalled();
  });

  it("hands the body, the user and the request's origin to notifyGrant", async () => {
    const res = await call(JSON.stringify({ githubId: 7 }));
    expect(await res.json()).toEqual({ notice: "emailed" });
    expect(notifyGrant).toHaveBeenLastCalledWith({ service: { kind: "service" }, send: "send", publicEmail: "lookup", origin: "http://localhost:3000" }, "u1", "abcdefghijklmnop", { githubId: 7 });
  });

  it("uses the site's origin on Vercel, a null body for bad JSON, and passes the status", async () => {
    vi.stubEnv("VERCEL", "1");
    notifyGrant.mockResolvedValueOnce({ status: 400, json: { error: "Send { githubId, note? }." } });
    const res = await call("not json");
    expect(res.status).toBe(400);
    expect(notifyGrant).toHaveBeenLastCalledWith(expect.objectContaining({ origin: "https://weft.zip" }), "u1", "abcdefghijklmnop", null);
  });
});
