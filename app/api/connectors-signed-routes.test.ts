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
const lib = vi.hoisted(() => ({ writeGrant: vi.fn(), writeAllow: vi.fn(), pinWorker: vi.fn(), listSigners: vi.fn(), registerSigner: vi.fn(), revokeSigner: vi.fn(), endorseSigner: vi.fn(), sweep: vi.fn() }));
vi.mock("@/lib/connector-signed", () => ({ writeGrant: lib.writeGrant, writeAllow: lib.writeAllow, pinWorker: lib.pinWorker }));
vi.mock("@/lib/connector-signers", () => ({ listSigners: lib.listSigners, registerSigner: lib.registerSigner, revokeSigner: lib.revokeSigner, endorseSigner: lib.endorseSigner }));
vi.mock("@/lib/connector-sweep", () => ({ sweep: lib.sweep }));

const grant = await import("./connectors/github/grant/route");
const allow = await import("./connectors/github/allow/route");
const pin = await import("./connectors/pin/route");
const signers = await import("./connectors/signers/route");
const endorse = await import("./connectors/signers/endorse/route");
const cron = await import("./cron/connectors/route");

const post = (body: unknown) => new Request("https://weft.zip/api/connectors/x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) });
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
    expect(lib.writeGrant).toHaveBeenCalledWith(deps.current, "u1", { a: 1 });
    expect(await (await allow.POST(post({ b: 2 }))).json()).toEqual({ ok: true });
    expect(lib.writeAllow).toHaveBeenCalledWith(deps.current, "u1", { b: 2 });
    expect(await (await pin.POST(post({ c: 3 }))).json()).toEqual({ ok: true, waitingUntil: null });
    expect(lib.pinWorker).toHaveBeenCalledWith(deps.current, "u1", { c: 3 });
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
    expect(lib.registerSigner).toHaveBeenCalledWith(deps.current, "u1", { key: "k" });
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
