// weft.zip's signed connector routes (app/api/connectors/{github/grant,github/allow,pin,signers}) and the hourly sweep
// (app/api/cron/connectors). The lib side is mocked here and tested on its own (lib/connector-signed.ts,
// lib/connector-signers.ts, lib/connector-sweep.ts); these check each route hands the body and the signed-in user on.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: async () => {} }));
const deps = vi.hoisted(() => {
  const holder: { current: object | null } = { current: { db: {} } };
  return holder;
});
vi.mock("@/lib/connector-deps", () => ({ connectorDeps: () => deps.current, NOT_SET_UP: { error: "not set up" } }));
vi.mock("@/lib/web-session", () => ({ bearerUser: () => Promise.resolve({ id: "u1", email: null, name: null, avatar: null }) }));
const lib = vi.hoisted(() => ({ writeGrant: vi.fn(), writeAllow: vi.fn(), pinWorker: vi.fn(), listSigners: vi.fn(), registerSigner: vi.fn(), revokeSigner: vi.fn(), endorseSigner: vi.fn(), sweep: vi.fn(), confirmByLink: vi.fn(), revokeByLink: vi.fn() }));
vi.mock("@/lib/connector-signer-links", async (real) => ({ ...(await real<object>()), confirmByLink: lib.confirmByLink, revokeByLink: lib.revokeByLink }));
vi.mock("@/lib/connector-signed", () => ({ writeGrant: lib.writeGrant, writeAllow: lib.writeAllow, pinWorker: lib.pinWorker }));
vi.mock("@/lib/connector-signers", () => ({ listSigners: lib.listSigners, registerSigner: lib.registerSigner, revokeSigner: lib.revokeSigner, endorseSigner: lib.endorseSigner }));
vi.mock("@/lib/connector-sweep", () => ({ sweep: lib.sweep }));

const grant = await import("./connectors/github/grant/route");
const allow = await import("./connectors/github/allow/route");
const pin = await import("./connectors/pin/route");
const signers = await import("./connectors/signers/route");
const endorse = await import("./connectors/signers/endorse/route");
const cron = await import("./cron/connectors/route");
const confirmRoute = await import("./connectors/signers/confirm/route");
const revokeRoute = await import("./connectors/signers/revoke/route");

const post = (body: unknown) => new Request("https://weft.zip/api/connectors/x", { method: "POST", headers: { authorization: "Bearer t", "x-forwarded-for": "203.0.113.9", "user-agent": "Weft/1" }, body: JSON.stringify(body) });
const ID = "0b7f7c1e-2f4a-4e8b-9a51-3c6d2e1f0a99";

beforeEach(() => {
  vi.clearAllMocks();
  deps.current = { db: {} };
});

describe("signed writes", () => {
  it("hands each body and the user to its writer and answers what it says", async () => {
    lib.writeGrant.mockResolvedValue({ ok: true, epoch: 1 });
    lib.writeAllow.mockResolvedValue({ ok: true });
    lib.pinWorker.mockResolvedValue({ ok: true, waitingUntil: null });
    expect(await (await grant.POST(post({ a: 1 }))).json()).toEqual({ ok: true, epoch: 1 });
    expect(lib.writeGrant).toHaveBeenCalledWith(deps.current, "u1", { a: 1 }, { ip: "203.0.113.9", ua: "Weft/1" });
    expect(await (await allow.POST(post({ b: 2 }))).json()).toEqual({ ok: true });
    expect(lib.writeAllow).toHaveBeenCalledWith(deps.current, "u1", { b: 2 });
    expect(await (await pin.POST(post({ c: 3 }))).json()).toEqual({ ok: true, waitingUntil: null });
    expect(lib.pinWorker).toHaveBeenCalledWith(deps.current, "u1", { c: 3 }, { ip: "203.0.113.9", ua: "Weft/1" });
  });
});

describe("/api/connectors/signers", () => {
  it("lists, registers, vouches for and revokes Mac keys", async () => {
    lib.listSigners.mockResolvedValue([{ id: "s1" }]);
    lib.registerSigner.mockResolvedValue({ id: "s2" });
    lib.endorseSigner.mockResolvedValue({ id: "s3" });
    lib.revokeSigner.mockResolvedValue({ grants: 2 });
    expect(await (await signers.GET(post(null))).json()).toEqual({ signers: [{ id: "s1" }] });
    expect(await (await signers.POST(post({ key: "k" }))).json()).toEqual({ signer: { id: "s2" } });
    expect(lib.registerSigner).toHaveBeenCalledWith(deps.current, "u1", { key: "k" }, { ip: "203.0.113.9", ua: "Weft/1" });
    expect(await (await endorse.POST(post({ key: "k" }))).json()).toEqual({ signer: { id: "s3" } });
    const del = (q: string) => new Request(`https://weft.zip/api/connectors/signers${q}`, { method: "DELETE", headers: { authorization: "Bearer t" } });
    expect(await (await signers.DELETE(del(`?id=${ID}`))).json()).toEqual({ ok: true, grants: 2 });
    expect(lib.revokeSigner).toHaveBeenCalledWith(deps.current, "u1", ID);
    const bad = await signers.DELETE(del("?id=nope"));
    expect([bad.status, await bad.json()]).toEqual([400, { error: "Name the Mac key." }]);
    expect((await signers.DELETE(del(""))).status).toBe(400);
  });
});

describe("GET /api/cron/connectors", () => {
  const call = (auth?: string) => new Request("https://weft.zip/api/cron/connectors", { headers: auth ? { authorization: auth } : {} });

  it("needs the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron.GET(call("Bearer x"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "sh");
    expect((await cron.GET(call("Bearer x"))).status).toBe(401);
    expect(lib.sweep).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("answers 503 unset, the sweep's counts, and 502 when it throws", async () => {
    vi.stubEnv("CRON_SECRET", "sh");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    deps.current = null;
    expect((await cron.GET(call("Bearer sh"))).status).toBe(503);
    deps.current = { db: {} };
    lib.sweep.mockResolvedValueOnce({ expired: 1, tokensRevoked: 2, tokensDropped: 0, disconnects: 0, failed: [] });
    expect(await (await cron.GET(call("Bearer sh"))).json()).toEqual({ expired: 1, tokensRevoked: 2, tokensDropped: 0, disconnects: 0, failed: 0 });
    lib.sweep.mockResolvedValueOnce({ expired: 0, tokensRevoked: 0, tokensDropped: 0, disconnects: 0, failed: ["grant g1: x"] });
    expect(((await (await cron.GET(call("Bearer sh"))).json()) as { failed: number }).failed).toBe(1);
    expect(errors).toHaveBeenCalledWith("Connector sweep: grant g1: x");
    lib.sweep.mockRejectedValueOnce(new Error("down"));
    expect((await cron.GET(call("Bearer sh"))).status).toBe(502);
    errors.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("the emailed links", () => {
  const form = (fields: Record<string, string>) => new Request("https://weft.zip/x", { method: "POST", body: new URLSearchParams(fields) });
  const text = async (res: Response) => res.text();

  it("show one button that POSTs back, with the link's id and token, and act only on the POST", async () => {
    for (const [route, path, button] of [[confirmRoute, "/api/connectors/signers/confirm", "Confirm this Mac key"], [revokeRoute, "/api/connectors/signers/revoke", "Revoke this key"]] as const) {
      const page = await text(await route.GET(new Request(`https://weft.zip${path}?id=s1&t=tok`)));
      expect(page).toContain(`<form method="post" action="${path}">`);
      expect(page).toContain('name="id" value="s1"');
      expect(page).toContain('name="t" value="tok"');
      expect(page).toContain(button);
      expect(await text(await route.GET(new Request(`https://weft.zip${path}`)))).toContain('name="t" value=""');
    }
    expect(lib.confirmByLink).not.toHaveBeenCalled();
    expect(lib.revokeByLink).not.toHaveBeenCalled();
  });

  it("confirm and revoke on the POST, and say why when they can't", async () => {
    expect(await text(await confirmRoute.POST(form({ id: "s1", t: "tok" })))).toContain("Mac key confirmed");
    expect(lib.confirmByLink).toHaveBeenCalledWith(deps.current, "s1", "tok");
    expect(await text(await revokeRoute.POST(form({ id: "s1", t: "tok" })))).toContain("Mac key revoked");
    expect(lib.revokeByLink).toHaveBeenCalledWith(deps.current, "s1", "tok", lib.revokeSigner);
    lib.confirmByLink.mockRejectedValueOnce(new Error("That link has been used."));
    expect(await text(await confirmRoute.POST(new Request("https://weft.zip/x", { method: "POST", body: "{" })))).toContain("That link has been used.");
    lib.revokeByLink.mockRejectedValueOnce(new Error("Not one Weft sent."));
    expect(await text(await revokeRoute.POST(new Request("https://weft.zip/x", { method: "POST", body: "{" })))).toContain("Not one Weft sent.");
    deps.current = null;
    expect(await text(await confirmRoute.POST(form({})))).toContain("Not set up yet");
    expect(await text(await revokeRoute.POST(form({})))).toContain("Not set up yet");
  });
});
