// GitHub for a worker being paired (electron/connector-grants.cjs planPairing): only once GitHub is connected, for the
// repos pairing's prompt names, at DEFAULT_SETTINGS, signed without a Touch ID of its own (pairing's covered it).
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../lib/connector-grant";
import { grantMessage } from "../lib/connector-messages";
import { verifyRaw } from "../lib/connector-trust";
import { macKey } from "../lib/connector-trust.harness";
import grants from "./connector-grants.cjs";

type Call = [method: string, path: string, body?: Record<string, unknown>];

function setup(o: { uid?: string | null; status?: unknown; repos?: number } = {}) {
  const k = macKey();
  const calls: Call[] = [];
  const call = vi.fn((method: string, path: string, body?: Record<string, unknown>) => {
    calls.push([method, path, body]);
    if (path === "/github") return o.status instanceof Error ? Promise.reject(o.status) : Promise.resolve(o.status ?? { connected: true });
    return Promise.resolve(path === "/github/grant" ? { ok: true } : { signer: { trusted: true } });
  });
  const confirm = vi.fn(() => Promise.resolve(true));
  const repos = Array.from({ length: o.repos ?? 2 }, (_, i) => ({ repo: `ada/r${i}`, recent: false }));
  const deps = { db: () => ({}), userId: () => (o.uid === undefined ? "u1" : o.uid), confirm, sign: (m: string) => Promise.resolve(k.sign(m)), signKey: () => Promise.resolve(k.key), pins: { pinned: () => ({ publicKey: "box", signKey: "sk" }) }, call, now: () => 1_000, knownRepos: () => Promise.resolve(repos) };
  const signer = grants.registerConnectorGrants(() => {}, deps as never);
  return { signer, calls, confirm, k };
}

describe("planPairing", () => {
  it("plans nothing signed out, not connected, unreachable, with no checkouts or too many to name", async () => {
    expect(await setup({ uid: null }).signer.planPairing()).toBeNull();
    expect(await setup({ status: { connected: false } }).signer.planPairing()).toBeNull();
    expect(await setup({ status: new Error("offline") }).signer.planPairing()).toBeNull();
    expect(await setup({ repos: 0 }).signer.planPairing()).toBeNull();
    expect(await setup({ repos: grants.MAX_REPOS + 1 }).signer.planPairing()).toBeNull();
  });

  it("names the repos, then sends a grant at the defaults without asking again", async () => {
    const s = setup();
    const plan = (await s.signer.planPairing())!;
    expect(plan.say).toBe("let its cards use GitHub as you, with Weft, for ada/r0, ada/r1");
    expect(await plan.run("w1")).toEqual({ ok: true, settings: DEFAULT_SETTINGS, waiting: false });
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(["GET /github", "POST /signers", "POST /pin", "POST /github/grant"]);
    const g = s.calls[3]?.[2] ?? {};
    expect(g).toMatchObject({ workerId: "w1", connector: "github", settings: DEFAULT_SETTINGS, repos: ["ada/r0", "ada/r1"], prevEpoch: 0 });
    const statement = { userId: "u1", workerId: "w1", connector: "github", settings: DEFAULT_SETTINGS, repos: ["ada/r0", "ada/r1"], nonce: g.nonce, issuedAt: 1_000, prevEpoch: 0 };
    expect(verifyRaw(s.k.key, grantMessage(statement as never), g.sig as string)).toBe(true);
  });
});
