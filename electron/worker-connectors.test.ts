// Connectors lent to a worker, on the Mac's side (electron/worker-connectors.cjs and its IPC): Touch ID to turn one on,
// the token sealed to the pinned box key and signed by this Mac, refreshed while it stays on, and a signed forget.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkerConnectors, REFRESH_MS } from "./worker-connectors.cjs";
import { registerWorkerConnectors } from "./worker-connectors-ipc.cjs";
import { createWorkerPins } from "./worker-pins.cjs";
import { connectorMessage, connectorPurpose } from "../lib/connector-wire";
import { macSigned } from "../lib/worker-mac-keys";
import { newSealKeys, open, type Sealed } from "../lib/worker-seal";

const keys = newSealKeys();
const SIGN_KEY = "SIGN";
const plainStore = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });
const macPair = crypto.generateKeyPairSync("ed25519");
const macKey = Buffer.from(macPair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
const signer = () => Promise.resolve({ publicKey: () => macKey, sign: (m: string) => crypto.sign(null, Buffer.from(m), macPair.privateKey).toString("base64") });

type Payload = { op: string; connector: string; nonce: string; issuedAt: number; sealed?: Sealed; mac: { key: string; sig: string } };
function setup({ worker = {}, pinned = true, confirmed = true, uid = "u1", insertError = null as { message: string } | null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "weft-wconn-"));
  const pins = createWorkerPins({ dir, safeStorage: plainStore });
  if (pinned) pins.pin("w1", { name: "m1mini", publicKey: keys.publicKey, signKey: SIGN_KEY });
  const row: Record<string, unknown> = { id: "w1", org_id: "org-1", name: "m1mini", owner_user: "u1", kind: "headless", public_key: keys.publicKey, sign_key: SIGN_KEY, revoked_at: null, ...worker };
  const inserted: { kind: string; target_device: string; org_id: string; payload: Payload }[] = [];
  const db = () => ({
    from: (table: string) => ({
      select: () => {
        const q = { eq: () => q, maybeSingle: () => Promise.resolve({ data: table === "cloud_workers" ? row : null }) };
        return q;
      },
      insert: (r: (typeof inserted)[number]) => (inserted.push(r), Promise.resolve({ error: insertError })),
    }),
  });
  let now = 1_000_000;
  const mint = {
    gog: vi.fn((account: string) => Promise.resolve({ token: `ya29.${account}`, account, expiresAt: now + 3_600_000 })),
    gh: vi.fn((account: string) => Promise.resolve({ token: "gho_abcdefghijklmnopqrstuvwxyz", account, expiresAt: now + 8 * 3_600_000 })),
    ghAccount: vi.fn(() => Promise.resolve("octocat")),
    forget: vi.fn(),
  };
  const confirm = vi.fn<(reason: string) => Promise<boolean>>(() => Promise.resolve(confirmed));
  const log = vi.fn();
  const c = createWorkerConnectors({ dir, safeStorage: plainStore, db, userId: () => uid, pins, signer, mint, confirm, now: () => now, log });
  return { c, dir, inserted, mint, confirm, log, row, tick: (ms: number) => (now += ms) };
}

const opened = (p: Payload) => JSON.parse(open(keys, p.sealed!, connectorPurpose(p.connector, p.nonce))) as Record<string, unknown>;
const signedByMac = (p: Payload) => macSigned(p.mac.key, connectorMessage(p.op, p.connector, p.nonce, p.issuedAt, p.sealed ?? null), p.mac.sig);

describe("createWorkerConnectors", () => {
  it("turns gog on after Touch ID that names the worker and account, and sends a sealed, signed token", async () => {
    const s = setup();
    expect(await s.c.enable("w1", "gog", "me@example.com")).toEqual({ enabled: true, account: "me@example.com" });
    expect(s.confirm.mock.calls[0]?.[0]).toContain("give the Weft Worker m1mini your Google Workspace (gog) sign-in (me@example.com)");
    const sent = s.inserted[0]!;
    expect(sent).toMatchObject({ kind: "connector", target_device: "worker:w1", org_id: "org-1", payload: { op: "token", connector: "gog" } });
    expect(JSON.stringify(sent)).not.toContain("ya29");
    expect(opened(sent.payload)).toMatchObject({ v: 1, connector: "gog", account: "me@example.com", token: "ya29.me@example.com", issuedAt: sent.payload.issuedAt });
    expect(signedByMac(sent.payload)).toBe(true);
    expect(s.c.list()).toEqual([{ workerId: "w1", connector: "gog", account: "me@example.com", since: expect.any(String) as unknown }]);
    expect(fs.readFileSync(path.join(s.dir, "vault", "worker-connectors.json"), "utf8")).not.toContain("ya29");
  });

  it("names gh's own account, and warns its token doesn't expire", async () => {
    const s = setup();
    expect(await s.c.enable("w1", "gh")).toEqual({ enabled: true, account: "octocat" });
    expect(s.confirm.mock.calls[0]?.[0]).toContain("GitHub's token itself doesn't expire");
    expect(s.mint.gh).toHaveBeenCalledWith("octocat");
  });

  it("does nothing on a no, and refuses an unknown connector or account", async () => {
    const s = setup({ confirmed: false });
    expect(await s.c.enable("w1", "gog", "me@example.com")).toEqual({ denied: true });
    expect(s.inserted).toEqual([]);
    expect(s.c.list()).toEqual([]);
    await expect(s.c.enable("w1", "slack", "x")).rejects.toThrow("Unknown connector.");
    await expect(s.c.enable("w1", "gog", "not an email")).rejects.toThrow("isn't an account");
    await expect(s.c.enable("w1", "gog")).rejects.toThrow("isn't an account");
  });

  it.each([
    [{ worker: { owner_user: "u2" } }, "isn't yours"],
    [{ worker: { kind: "desktop" } }, "isn't yours"],
    [{ worker: { revoked_at: "2026-01-01" } }, "was revoked"],
    [{ pinned: false }, "isn't paired with this Mac"],
    [{ worker: { sign_key: "OTHER" } }, "isn't paired with this Mac"],
  ])("refuses a worker that %o", async (over, why) => {
    const s = setup(over);
    await expect(s.c.enable("w1", "gog", "me@example.com")).rejects.toThrow(why);
    expect(s.confirm).not.toHaveBeenCalled();
  });

  it("refuses a worker whose box key changed since it was pinned", async () => {
    await expect(setup({ worker: { public_key: newSealKeys().publicKey } }).c.enable("w1", "gog", "me@example.com")).rejects.toThrow("key changed");
  });

  it("refreshes each connector when it's due, later than before, and only while signed in", async () => {
    const s = setup();
    await s.c.enable("w1", "gog", "me@example.com");
    await s.c.refresh();
    expect(s.inserted).toHaveLength(1);
    s.tick(REFRESH_MS.gog);
    await s.c.refresh();
    expect(s.inserted).toHaveLength(2);
    expect(s.inserted[1]!.payload.issuedAt).toBeGreaterThan(s.inserted[0]!.payload.issuedAt);
    const out = setup({ uid: "" });
    await out.c.refresh();
    expect(out.mint.gog).not.toHaveBeenCalled();
  });

  it("drops a revoked worker's grants on refresh, and logs a failure that isn't that", async () => {
    const s = setup();
    await s.c.enable("w1", "gog", "me@example.com");
    s.tick(REFRESH_MS.gog);
    s.mint.gog.mockRejectedValueOnce(new Error("Google refused"));
    await s.c.refresh();
    expect(s.log).toHaveBeenCalledWith(expect.stringContaining("Google refused"));
    expect(s.c.list()).toHaveLength(1);
    s.row.revoked_at = "now";
    await s.c.refresh();
    expect(s.c.list()).toEqual([]);
  });

  it("turns off with a signed forget, and still turns off when the worker can't be told", async () => {
    const s = setup();
    await s.c.enable("w1", "gog", "me@example.com");
    expect(await s.c.disable("w1", "gog")).toEqual({ disabled: true });
    const forget = s.inserted[1]!.payload;
    expect(forget).toMatchObject({ op: "forget", connector: "gog" });
    expect(forget.sealed).toBeUndefined();
    expect(signedByMac(forget)).toBe(true);
    expect(s.mint.forget).toHaveBeenCalledWith("me@example.com");
    expect(s.c.list()).toEqual([]);
    const gone = setup({ worker: { revoked_at: "x" } });
    expect(await gone.c.disable("w1", "gh")).toEqual({ disabled: true, note: "m1mini was revoked. Its token runs out on its own." });
  });

  it("says when the insert fails, and when its sealed file won't open", async () => {
    const s = setup({ insertError: { message: "denied" } });
    await expect(s.c.enable("w1", "gog", "me@example.com")).rejects.toThrow("Couldn't send it to m1mini: denied");
    fs.writeFileSync(path.join(s.dir, "vault", "worker-connectors.json"), "garbage");
    const broken = createWorkerConnectors({ dir: s.dir, safeStorage: () => ({ encryptString: (x: string) => Buffer.from(x), decryptString: () => "{" }), db: () => ({}), userId: () => "u1", pins: { lookup: vi.fn() }, signer, mint: s.mint, confirm: vi.fn() });
    expect(() => broken.list()).toThrow("won't open");
  });
});

describe("registerWorkerConnectors", () => {
  it("answers list, enable and disable over the board's IPC and starts the refresh timer", async () => {
    const s = setup();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const every = vi.fn((fn: () => void) => {
      fn();
      return { unref: vi.fn() };
    });
    const dir = s.dir;
    const pins = createWorkerPins({ dir, safeStorage: plainStore });
    registerWorkerConnectors((ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn), { dir, safeStorage: plainStore, db: () => ({}), userId: () => "", pins, signer, mint: s.mint, confirm: vi.fn() }, { every });
    expect(every).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000);
    expect(await handlers.get("worker-connectors:list")!()).toEqual([]);
    await expect(handlers.get("worker-connectors:enable")!(undefined, "x")).rejects.toThrow("Unknown connector.");
    expect(await handlers.get("worker-connectors:disable")!("w1", "gh")).toMatchObject({ disabled: true });
    await expect(handlers.get("worker-connectors:enable")!("w1", "gog", "me@example.com")).rejects.toThrow();
  });
});
