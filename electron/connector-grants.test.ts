// A worker's connector grants, made in main (electron/connector-grants.cjs): Touch ID before every change, then this
// Mac's approval key signs exactly what weft.zip writes, checked here against lib/connector-messages.ts's messages
// with the verifier weft.zip uses; the worker vouched for from this Mac's own pin; its rules held to lib/connector-grant.ts.
import { describe, expect, it, vi } from "vitest";
import * as shared from "../lib/connector-grant";
import { allowMessage, endorseMessage, grantMessage, signerMessage, workerMessage } from "../lib/connector-messages";
import { verifyRaw } from "../lib/connector-trust";
import { macKey } from "../lib/connector-trust.harness";
import grants from "./connector-grants.cjs";

const { registerConnectorGrants, createConnectorSigner, weftZip } = grants;
type Fn = (...args: unknown[]) => Promise<unknown>;
type Call = [method: string, path: string, body?: Record<string, unknown>];

const STRICT = { scope: "card", approval: "card", lifetime: "8h", asks: ["protected_push"] };
const PIN = { publicKey: "boxkey", signKey: "signkey" };

function fakeDb(read: { data?: unknown; error?: unknown } = {}) {
  const reads: [string, unknown][] = [];
  const chain = {
    eq: (k: string, v: unknown) => (reads.push([k, v]), chain),
    maybeSingle: () => Promise.resolve({ data: read.data ?? null, error: read.error ?? null }),
  };
  return { db: () => ({ from: () => ({ select: () => chain }) }), reads };
}

function setup(o: { uid?: string | null; yes?: boolean; read?: { data?: unknown; error?: unknown }; pin?: object | null; answers?: Record<string, unknown>; repos?: string[] } = {}) {
  const handlers = new Map<string, Fn>();
  const k = macKey();
  const { db, reads } = fakeDb(o.read);
  const calls: Call[] = [];
  const call = vi.fn((method: string, path: string, body?: Record<string, unknown>) => (calls.push([method, path, body]), Promise.resolve(o.answers?.[path] ?? { signer: { trusted: true }, signers: [] })));
  const confirm = vi.fn<(reason: string) => Promise<boolean>>(() => Promise.resolve(o.yes ?? true));
  const deps = {
    db,
    userId: () => (o.uid === undefined ? "u1" : o.uid),
    confirm,
    sign: (m: string) => Promise.resolve(k.sign(m)),
    signKey: () => Promise.resolve(k.key),
    pins: { pinned: () => (o.pin === undefined ? PIN : o.pin) },
    call,
    macName: () => "Ada's Mac\n",
    device: () => "dev-1",
    now: () => 1_000,
    knownRepos: () => Promise.resolve(o.repos ?? ["ada/app", "ada/web"]),
  };
  const signer = registerConnectorGrants((ch: string, fn: (...args: never[]) => unknown) => void handlers.set(ch, fn as Fn), deps as never);
  const h = (ch: string) => handlers.get(ch)!;
  return { h, handlers, calls, confirm, reads, k, signer };
}

const sent = (calls: Call[], path: string) => calls.find((c) => c[1] === path)?.[2] as Record<string, unknown>;

describe("registerConnectorGrants", () => {
  it("registers the board's channels", () => {
    expect([...setup().handlers.keys()]).toEqual(["connectors:set", "connectors:allow", "connectors:signers", "connectors:trust", "connectors:forget-signer"]);
  });
});

describe("connectors:set", () => {
  it("refuses when signed out, and for a connector it doesn't know", async () => {
    await expect(setup({ uid: null }).h("connectors:set")("w1", "box", "github", {})).rejects.toThrow("Sign in to Weft first.");
    await expect(setup().h("connectors:set")("w1", "box", "gitlab", {})).rejects.toThrow("doesn't know that connector");
  });

  it("asks Touch ID naming the worker, then registers this Mac, vouches for the worker and sends a signed grant", async () => {
    const s = setup({ answers: { "/github/grant": { ok: true, waiting: true } } });
    expect(await s.h("connectors:set")("w1", "m1\nmini", "github", { scope: "card", bogus: 1 })).toEqual({ ok: true, settings: { scope: "card", approval: "worker", lifetime: "revoked", asks: ["protected_push"] }, waiting: true });
    expect(s.confirm).toHaveBeenCalledWith("let the worker m1?mini use GitHub as you, with Weft, for cards you start on it, for ada/app, ada/web");
    expect(s.reads).toEqual([["user_id", "u1"], ["worker_id", "w1"], ["connector", "github"]]);
    expect(s.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(["POST /signers", "POST /pin", "POST /github/grant"]);
    const reg = sent(s.calls, "/signers");
    expect(reg).toMatchObject({ key: s.k.key, name: "Ada's Mac?", device: "dev-1", issuedAt: 1_000 });
    expect(verifyRaw(s.k.key, signerMessage({ userId: "u1", key: s.k.key, name: "Ada's Mac?", issuedAt: 1_000 }), reg.sig as string)).toBe(true);
    const pin = sent(s.calls, "/pin");
    expect(pin).toMatchObject({ workerId: "w1", signKey: "signkey", boxKey: "boxkey", signerKey: s.k.key });
    expect(verifyRaw(s.k.key, workerMessage({ userId: "u1", workerId: "w1", signKey: "signkey", boxKey: "boxkey" }), pin.sig as string)).toBe(true);
    const g = sent(s.calls, "/github/grant");
    expect(g).toMatchObject({ workerId: "w1", connector: "github", prevEpoch: 0, issuedAt: 1_000, signerKey: s.k.key });
    expect(g.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(g.repos).toEqual(["ada/app", "ada/web"]);
    const message = grantMessage({ userId: "u1", workerId: "w1", connector: "github", settings: g.settings as shared.GrantSettings, repos: ["ada/app", "ada/web"], nonce: g.nonce as string, issuedAt: 1_000, prevEpoch: 0 });
    expect(verifyRaw(s.k.key, message, g.sig as string)).toBe(true);
  });

  it("writes nothing when Touch ID says no", async () => {
    const no = setup({ yes: false });
    expect(await no.h("connectors:set")("w1", "", "github", {})).toEqual({ denied: true });
    expect(no.confirm.mock.calls[0]![0]).toContain("the worker w1 use");
    expect(no.calls).toEqual([]);
  });

  it("asks Touch ID for a stricter change too, and signs over the epoch it replaces", async () => {
    const s = setup({ read: { data: { scope: "installed", approval: "worker", lifetime: "revoked", asks: [], repos: ["ada/app", "ada/web", "ada/old"], epoch: 4 } }, answers: { "/github/grant": { ok: true } } });
    expect(await s.h("connectors:set")("w1", "box", "github", STRICT)).toMatchObject({ ok: true, waiting: false });
    expect(s.confirm).toHaveBeenCalledWith("make GitHub on the worker box stricter (card repos, approval card, lifetime 8h, for ada/app, ada/web)");
    expect(sent(s.calls, "/github/grant").prevEpoch).toBe(4);
  });

  it("names a looser change as giving cards more", async () => {
    const s = setup({ read: { data: STRICT } });
    await s.h("connectors:set")("w1", "box", "github", { ...STRICT, scope: "installed" });
    expect(s.confirm).toHaveBeenCalledWith("give cards on the worker box more GitHub access (installed repos, approval card, lifetime 8h, for ada/app, ada/web)");
    const more = setup({ read: { data: { ...STRICT, repos: ["ada/app"] } }, repos: ["ada/app", "b/1", "b/2", "b/3"] });
    await more.h("connectors:set")("w1", "box", "github", STRICT);
    expect(more.confirm).toHaveBeenCalledWith("give cards on the worker box more GitHub access (card repos, approval card, lifetime 8h, for ada/app, b/1, b/2 and 1 more)");
    const none = setup({ repos: [] });
    await none.h("connectors:set")("w1", "box", "github", STRICT);
    expect(none.confirm.mock.calls[0]![0]).toContain("for no repos (this Mac has no GitHub checkouts)");
  });

  it("refuses to vouch for a worker this Mac didn't pair, and throws on a read error", async () => {
    await expect(setup({ pin: null }).h("connectors:set")("w1", "b", "github", {})).rejects.toThrow("didn't pair that worker");
    await expect(setup({ pin: { publicKey: "b" } }).h("connectors:set")("w1", "b", "github", {})).rejects.toThrow("didn't pair that worker");
    await expect(setup({ read: { error: { message: "rls" } } }).h("connectors:set")("w1", "b", "github", {})).rejects.toThrow("Couldn't read the grant: rls");
  });
});

describe("connectors:allow", () => {
  it("allows a project or a card after Touch ID, signed", async () => {
    const s = setup();
    expect(await s.h("connectors:allow")("g1", "box", "project", "o/r")).toEqual({ ok: true });
    expect(s.confirm).toHaveBeenCalledWith("let the project o/r on the worker box use GitHub as you");
    const a = sent(s.calls, "/github/allow");
    expect(a).toMatchObject({ userId: "u1", grantId: "g1", kind: "project", subject: "o/r", signerKey: s.k.key });
    expect(verifyRaw(s.k.key, allowMessage({ userId: "u1", grantId: "g1", kind: "project", subject: "o/r", nonce: a.nonce as string, issuedAt: 1_000 }), a.sig as string)).toBe(true);
    await s.h("connectors:allow")("g1", "box", "card", "c".repeat(300), "Fix it");
    expect(s.confirm).toHaveBeenLastCalledWith('let the card "Fix it" on the worker box use GitHub as you');
    expect((s.calls.at(-1)![2]!.subject as string).length).toBe(201);
    await s.h("connectors:allow")("g1", "box", "card", "card-id");
    expect(s.confirm).toHaveBeenLastCalledWith('let the card "card-id" on the worker box use GitHub as you');
    await s.h("connectors:allow")("g1", undefined, "project", "o/r");
    expect(s.confirm).toHaveBeenLastCalledWith("let the project o/r on the worker  use GitHub as you");
  });

  it("refuses a bad kind or no sign-in, and sends nothing on no", async () => {
    await expect(setup().h("connectors:allow")("g1", "box", "repo", "x")).rejects.toThrow("Allow a project or a card.");
    await expect(setup({ uid: null }).h("connectors:allow")("g1", "box", "card", "x")).rejects.toThrow("Sign in to Weft first.");
    const no = setup({ yes: false });
    expect(await no.h("connectors:allow")("g1", "box", "card", "x")).toEqual({ denied: true });
    expect(no.calls).toEqual([]);
  });
});

describe("connectors:signers, :trust and :forget-signer", () => {
  it("lists this Mac's key and every key, registering nothing", async () => {
    const s = setup({ answers: { "/signers": { signer: {}, signers: [{ id: "s1" }] } } });
    expect(await s.h("connectors:signers")()).toEqual({ mine: s.k.key, signers: [{ id: "s1" }] });
    expect(s.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(["GET /signers"]);
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it("vouches for another Mac after Touch ID naming it and its fingerprint", async () => {
    const s = setup();
    const other = macKey();
    expect(await s.h("connectors:trust")(other.key, "New\nMac")).toEqual({ ok: true });
    expect(s.confirm.mock.calls[0]![0]).toBe(`trust the Mac "New?Mac" (key ${grants.fingerprint(other.key)}) to approve connectors for you. Only if you just set that Mac up`);
    expect(grants.fingerprint(other.key)).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    const e = sent(s.calls, "/signers/endorse");
    expect(verifyRaw(s.k.key, endorseMessage({ userId: "u1", key: other.key, by: s.k.key, issuedAt: 1_000 }), e.sig as string)).toBe(true);
    const no = setup({ yes: false });
    expect(await no.h("connectors:trust")(other.key, "x")).toEqual({ denied: true });
    expect(no.calls).toEqual([]);
    await expect(setup({ uid: null }).h("connectors:trust")(other.key, "x")).rejects.toThrow("Sign in to Weft first.");
  });

  it("takes a key's trust away through weft.zip, and registers afresh after", async () => {
    const s = setup();
    await s.signer.register();
    await s.h("connectors:forget-signer")("s 1");
    expect(s.calls.slice(1)).toEqual([["DELETE", "/signers?id=s%201", undefined]]);
    await s.signer.register();
    expect(s.calls.filter((c) => c[1] === "/signers" && c[0] === "POST")).toHaveLength(2);
  });

  it("registers once in 10 minutes per account and key", async () => {
    const k = macKey();
    let t = 0;
    let uid = "u1";
    const call = vi.fn(() => Promise.resolve({ signer: {} }));
    const signer = createConnectorSigner({ db: () => ({}), userId: () => uid, sign: (m: string) => Promise.resolve(k.sign(m)), signKey: () => Promise.resolve(k.key), pins: { pinned: () => null }, call, now: () => t });
    await signer.register();
    t = 9 * 60_000;
    await signer.register();
    expect(call).toHaveBeenCalledTimes(1);
    uid = "u2";
    await signer.register();
    expect(call).toHaveBeenCalledTimes(2);
    t = 20 * 60_000;
    await signer.register();
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("can't register signed out", async () => {
    await expect(setup({ uid: null }).signer.register()).rejects.toThrow("Sign in to Weft first.");
  });
});

describe("createConnectorSigner defaults", () => {
  it("names the Mac by its host name and signs at the time now", async () => {
    const k = macKey();
    const call = vi.fn(() => Promise.resolve({ signer: {} }));
    const signer = createConnectorSigner({ db: () => ({}), userId: () => "u1", sign: (m: string) => Promise.resolve(k.sign(m)), signKey: () => Promise.resolve(k.key), pins: { pinned: () => null }, call });
    await signer.register();
    const body = (call.mock.calls[0] as unknown as Call)[2]!;
    expect(typeof body.name).toBe("string");
    expect(body.device).toBe("");
    expect(Math.abs((body.issuedAt as number) - Date.now())).toBeLessThan(5_000);
  });
});

describe("weftZip", () => {
  const db = (token: string | null) => () => ({ auth: { getSession: () => Promise.resolve({ data: { session: token ? { access_token: token } : null } }) } });

  it("calls weft.zip's connector routes with this account's session", async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({ ok: 1 })));
    const call = weftZip({ db: db("tok"), fetch: fetch, site: "https://weft.test/" });
    expect(await call("POST", "/pin", { a: 1 })).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledWith("https://weft.test/api/connectors/pin", { method: "POST", headers: { authorization: "Bearer tok", "content-type": "application/json" }, body: '{"a":1}' });
    await call("GET", "/signers");
    expect(fetch).toHaveBeenLastCalledWith("https://weft.test/api/connectors/signers", { method: "GET", headers: { authorization: "Bearer tok" } });
  });

  it("says why when it can't", async () => {
    await expect(weftZip({ db: db(null), fetch: vi.fn() as never })("GET", "/x")).rejects.toThrow("Sign in to Weft first.");
    await expect(weftZip({ db: db("t"), fetch: (() => Promise.reject(new Error("offline"))) })("GET", "/x")).rejects.toThrow("Couldn't reach weft.zip.");
    await expect(weftZip({ db: db("t"), fetch: (() => Promise.resolve(Response.json({ error: "nope" }, { status: 409 }))) })("GET", "/x")).rejects.toThrow("nope");
    await expect(weftZip({ db: db("t"), fetch: (() => Promise.resolve(new Response("<html>", { status: 500 }))) })("GET", "/x")).rejects.toThrow("weft.zip answered HTTP 500.");
    const session = () => ({ auth: { getSession: () => Promise.resolve(null) } });
    await expect(weftZip({ db: session })("GET", "/x")).rejects.toThrow("Sign in to Weft first.");
  });
});

describe("parity with lib/connector-grant.ts", () => {
  it("has the same choices", () => {
    expect(grants.SCOPES).toEqual(shared.SCOPES);
    expect(grants.APPROVALS).toEqual(shared.APPROVALS);
    expect(grants.LIFETIMES).toEqual(shared.LIFETIMES);
    expect(grants.ASKS).toEqual(shared.ASKS);
  });

  const raws: unknown[] = [null, undefined, "x", 3, {}, { scope: "card" }, { scope: "nope", approval: "project", lifetime: "8h" }, { asks: [] }, { asks: ["protected_push", "protected_push", "x", 1] }, { asks: "protected_push" }, STRICT];
  it.each(raws.map((r) => [r]))("settingsOf(%j) agrees", (raw) => expect(grants.settingsOf(raw)).toEqual(shared.settingsOf(raw)));

  const all: shared.GrantSettings[] = [];
  for (const scope of shared.SCOPES) for (const approval of shared.APPROVALS) for (const lifetime of shared.LIFETIMES) for (const asks of [[], ["protected_push"]] as shared.Ask[][]) all.push({ scope, approval, lifetime, asks });
  it("looser agrees on every pair of settings", () => {
    let loose = 0;
    for (const was of all)
      for (const next of all) {
        const want = shared.looser(was, next);
        expect(grants.looser(was, next), `${JSON.stringify(was)} → ${JSON.stringify(next)}`).toBe(want);
        if (want) loose++;
      }
    expect(loose).toBeGreaterThan(0);
    expect(loose).toBeLessThan(all.length * all.length);
  });
});

describe("registerConnectorGrants defaults", () => {
  it("covers no repos when it isn't told how to find them", async () => {
    const handlers = new Map<string, Fn>();
    const k = macKey();
    const calls: Call[] = [];
    const call = (method: string, path: string, body?: Record<string, unknown>) => (calls.push([method, path, body]), Promise.resolve({ signer: {} }));
    registerConnectorGrants((ch: string, fn: (...args: never[]) => unknown) => void handlers.set(ch, fn as Fn), { db: fakeDb().db, userId: () => "u1", confirm: () => Promise.resolve(true), sign: (m: string) => Promise.resolve(k.sign(m)), signKey: () => Promise.resolve(k.key), pins: { pinned: () => PIN }, call } as never);
    await handlers.get("connectors:set")!("w1", "box", "github", {});
    expect(sent(calls, "/github/grant").repos).toEqual([]);
  });
});
