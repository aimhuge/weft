// weft.zip's GitHub connector routes (app/api/connectors/github/*): status and disconnect, revoke and mint for the
// desktop and the workers, and the connect flow's start and callback. The lib side (lib/connector-*.ts) is mocked here
// and tested on its own; these check the gates, the cookie and what each route answers.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MintError } from "@/lib/connector-tokens";

vi.mock("next/server", () => ({ connection: async () => {} }));
const jar = vi.hoisted(() => ({ value: undefined as string | undefined, get: vi.fn(), set: vi.fn<(name: string, value: string, opts: unknown) => void>(), delete: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(jar) }));

const deps = vi.hoisted(() => ({ current: null as object | null }));
vi.mock("@/lib/connector-deps", () => ({ connectorDeps: () => deps.current, NOT_SET_UP: { error: "GitHub connectors aren't set up on this server yet." } }));

const session = vi.hoisted(() => ({ bearerUser: vi.fn(), webUser: vi.fn() }));
vi.mock("@/lib/web-session", () => session);

const lib = vi.hoisted(() => ({ connectStatus: vi.fn(), finishConnect: vi.fn(), disconnect: vi.fn(), revokeWorker: vi.fn(), mint: vi.fn() }));
vi.mock("@/lib/connector-connect", async (real) => ({ ...(await real<object>()), connectStatus: lib.connectStatus, finishConnect: lib.finishConnect }));
vi.mock("@/lib/connector-revoke", () => ({ disconnect: lib.disconnect, revokeWorker: lib.revokeWorker }));
vi.mock("@/lib/connector-mint", () => ({ mint: lib.mint }));

const status = await import("./connectors/github/route");
const revoke = await import("./connectors/github/revoke/route");
const mintRoute = await import("./connectors/github/mint/route");
const start = await import("./connectors/github/start/route");
const callback = await import("./connectors/github/callback/route");

const BASE = "https://weft.zip/api/connectors/github";
const USER = { id: "u1", email: null, name: null, avatar: null };
const WORKER = "0b7f7c1e-2f4a-4e8b-9a51-3c6d2e1f0a99";
const bearer = (path = "", init: RequestInit = {}) => new Request(`${BASE}${path}`, { ...init, headers: { authorization: "Bearer tok", host: "weft.zip", ...(init.headers as Record<string, string> | undefined) } });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => bearer(path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers });
const page = async (res: Response) => ({ status: res.status, text: await res.text() });

beforeEach(() => {
  vi.clearAllMocks();
  deps.current = { cfg: { clientId: "Iv1.abc", clientSecret: "s" } };
  session.bearerUser.mockResolvedValue(USER);
  session.webUser.mockResolvedValue(USER);
  jar.value = undefined;
  jar.get.mockImplementation(() => (jar.value === undefined ? undefined : { value: jar.value }));
});

describe("GET/DELETE /api/connectors/github", () => {
  it("answers 503 on a server that isn't set up", async () => {
    deps.current = null;
    const res = await status.GET(bearer());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "GitHub connectors aren't set up on this server yet." });
    expect(session.bearerUser).not.toHaveBeenCalled();
  });

  it("needs your session as a bearer", async () => {
    session.bearerUser.mockResolvedValue(null);
    const res = await status.DELETE(bearer("", { method: "DELETE" }));
    expect(res.status).toBe(401);
    expect(lib.disconnect).not.toHaveBeenCalled();
  });

  it("says whether you've connected, and doesn't cache it", async () => {
    lib.connectStatus.mockResolvedValue({ connected: true, login: "ada" });
    const res = await status.GET(bearer());
    expect(await res.json()).toEqual({ connected: true, login: "ada" });
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(lib.connectStatus).toHaveBeenCalledWith(deps.current, "u1");
  });

  it("disconnects", async () => {
    lib.disconnect.mockResolvedValue({ grants: 2, authorization: "deleted" });
    const res = await status.DELETE(bearer("", { method: "DELETE" }));
    expect(await res.json()).toEqual({ ok: true, grants: 2, authorization: "deleted" });
  });

  it("answers 502 with the reason when either fails", async () => {
    lib.connectStatus.mockRejectedValue(new Error("db down"));
    lib.disconnect.mockRejectedValue(new Error("GitHub down"));
    const got = await status.GET(bearer());
    expect([got.status, await got.json()]).toEqual([502, { error: "db down" }]);
    const gone = await status.DELETE(bearer("", { method: "DELETE" }));
    expect([gone.status, await gone.json()]).toEqual([502, { error: "GitHub down" }]);
  });
});

describe("POST /api/connectors/github/revoke", () => {
  it("answers 503 not set up, then 401 signed out", async () => {
    deps.current = null;
    expect((await revoke.POST(post("/revoke", { workerId: WORKER }))).status).toBe(503);
    deps.current = {};
    session.bearerUser.mockResolvedValue(null);
    expect((await revoke.POST(post("/revoke", { workerId: WORKER }))).status).toBe(401);
  });

  it("needs a worker id that looks like one, and survives a body that isn't JSON", async () => {
    for (const body of [{ workerId: "w1" }, { workerId: 7 }, {}, "not json", "null"]) {
      const res = await revoke.POST(post("/revoke", body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Name the worker." });
    }
    expect(lib.revokeWorker).not.toHaveBeenCalled();
  });

  it("revokes and says what GitHub confirmed", async () => {
    lib.revokeWorker.mockResolvedValue({ grants: 1, tokensRevoked: 1, unconfirmed: [], userToken: "rotated" });
    const res = await revoke.POST(post("/revoke", { workerId: WORKER }));
    expect(await res.json()).toEqual({ ok: true, grants: 1, tokensRevoked: 1, unconfirmed: [], userToken: "rotated" });
    expect(lib.revokeWorker).toHaveBeenCalledWith(deps.current, "u1", WORKER);
  });

  it("answers a MintError with its own status, anything else with 502", async () => {
    lib.revokeWorker.mockRejectedValueOnce(new MintError(404, "That isn't one of your workers."));
    const refused = await revoke.POST(post("/revoke", { workerId: WORKER }));
    expect([refused.status, await refused.json()]).toEqual([404, { error: "That isn't one of your workers." }]);
    lib.revokeWorker.mockRejectedValueOnce(new Error("boom"));
    expect((await revoke.POST(post("/revoke", { workerId: WORKER }))).status).toBe(502);
  });
});

describe("POST /api/connectors/github/mint", () => {
  it("answers 503 on a server that isn't set up", async () => {
    deps.current = null;
    expect((await mintRoute.POST(post("/mint", {}))).status).toBe(503);
    expect(lib.mint).not.toHaveBeenCalled();
  });

  it("hands the key and the body to mint and answers with its status", async () => {
    lib.mint.mockResolvedValue({ status: 200, body: { token: "ghu_x" } });
    const res = await mintRoute.POST(post("/mint", { card: "c1" }, { authorization: "Bearer wwk_1" }));
    expect([res.status, await res.json()]).toEqual([200, { token: "ghu_x" }]);
    expect(lib.mint).toHaveBeenCalledWith(deps.current, "Bearer wwk_1", { card: "c1" });
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("passes null for a body that isn't JSON", async () => {
    lib.mint.mockResolvedValue({ status: 400, body: { error: "bad" } });
    const res = await mintRoute.POST(post("/mint", "{"));
    expect(res.status).toBe(400);
    expect(lib.mint).toHaveBeenCalledWith(deps.current, "Bearer tok", null);
  });
});

describe("GET /api/connectors/github/start", () => {
  it("says so on a server that isn't set up", async () => {
    deps.current = null;
    const res = await page(await start.GET(bearer("/start")));
    expect(res.status).toBe(200);
    expect(res.text).toContain("Not set up yet");
  });

  it("sends a signed-out visitor to /login and back", async () => {
    session.webUser.mockResolvedValue(null);
    const res = await start.GET(bearer("/start"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://weft.zip/login?next=${encodeURIComponent("/api/connectors/github/start")}`);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("keeps the flow in a short httpOnly cookie and goes to GitHub's consent page", async () => {
    const res = await start.GET(bearer("/start"));
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.origin + to.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(to.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(to.searchParams.get("redirect_uri")).toBe("https://weft.zip/api/connectors/github/callback");
    const [name, cookie, opts] = jar.set.mock.calls[0]!;
    expect(name).toBe("weft_github_connect");
    expect(cookie).toMatch(new RegExp(`^u1\\.${to.searchParams.get("state")}\\.`));
    expect(opts).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/api/connectors/github", maxAge: 600 });
  });

  it("drops secure on a plain-http origin (a local server)", async () => {
    await start.GET(new Request("http://localhost:3000/api/connectors/github/start", { headers: { host: "localhost:3000" } }));
    expect(jar.set.mock.calls[0]![2]).toMatchObject({ secure: false });
  });
});

describe("GET /api/connectors/github/callback", () => {
  const back = (q: string) => new Request(`${BASE}/callback?${q}`, { headers: { host: "weft.zip" } });
  const kept = () => (jar.value = "u1.st8.verif");

  it("says so on a server that isn't set up", async () => {
    deps.current = null;
    expect((await page(await callback.GET(back("code=c&state=st8")))).text).toContain("Not set up yet");
  });

  it("always clears the cookie, and wants you signed in", async () => {
    kept();
    session.webUser.mockResolvedValue(null);
    expect((await page(await callback.GET(back("code=c&state=st8")))).text).toContain("Sign in first");
    expect(jar.delete).toHaveBeenCalledWith({ name: "weft_github_connect", path: "/api/connectors/github" });
    expect(lib.finishConnect).not.toHaveBeenCalled();
  });

  it("says GitHub didn't authorize when it sends an error back", async () => {
    kept();
    expect((await page(await callback.GET(back("error=access_denied&state=st8")))).text).toContain("GitHub didn&#39;t authorize the Weft app");
  });

  it("refuses a state or cookie that isn't this visitor's own, or no code", async () => {
    for (const [cookie, q] of [[undefined, "code=c&state=st8"], ["u1.other.verif", "code=c&state=st8"], ["u2.st8.verif", "code=c&state=st8"], ["u1.st8.verif", "state=st8"]] as const) {
      jar.value = cookie;
      expect((await page(await callback.GET(back(q)))).text).toContain("didn&#39;t come from your own Connect GitHub");
    }
    expect(lib.finishConnect).not.toHaveBeenCalled();
  });

  it("trades the code with the kept verifier and names who you are on GitHub", async () => {
    kept();
    lib.finishConnect.mockResolvedValue("ada");
    const res = await page(await callback.GET(back("code=c0de&state=st8")));
    expect(res.text).toContain("GitHub connected");
    expect(res.text).toContain("@ada");
    expect(lib.finishConnect).toHaveBeenCalledWith(deps.current, "u1", { code: "c0de", verifier: "verif", redirectUri: "https://weft.zip/api/connectors/github/callback" });
  });

  it("says why when the trade fails", async () => {
    kept();
    lib.finishConnect.mockRejectedValue(new Error("GitHub refused the code: bad_verification_code"));
    const res = await page(await callback.GET(back("code=c0de&state=st8")));
    expect(res.text).toContain("Not connected");
    expect(res.text).toContain("GitHub refused the code: bad_verification_code");
  });
});
