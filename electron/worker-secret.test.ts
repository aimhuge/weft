// Main's side of a worker's secret run (electron/worker-secret.cjs): it believes only what it reads itself, holds the
// worker to the key it pinned, asks once at a time, and lets the values out only sealed to that pinned key.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describe as describeRun } from "./secret-run.cjs";
import { askMessage, createWorkerSecrets, verifyAsk } from "./worker-secret.cjs";
import { createWorkerPins } from "./worker-pins.cjs";
import { secretUseMessage, secretUsePurpose } from "../lib/secret-use";
import { macSigned } from "../lib/worker-mac-keys";
import { newSealKeys, open } from "../lib/worker-seal";

const NOW = 1_000_000;
const NONCE = "b".repeat(64);
const keys = newSealKeys();
const ask = (over: Record<string, unknown> = {}) => ({ nonce: NONCE, command: "npm run job", names: ["TOKEN"], environment: "production", remote: "git@github.com:Aimhuge/Weft.git", expiresAt: NOW + 60_000, cwd: "app", script: "job: node job.js", why: "Ship", thread: "Deploy", ...over });
const callRow = (over: Record<string, unknown> = {}) => ({ id: "call-1", org_id: "org-1", owner_user: "u1", worker_id: "w1", card_id: "card-1", tool: "secret_run", args: ask(), status: "claimed", ...over });
const workerRow = (over: Record<string, unknown> = {}) => ({ id: "w1", name: "m1mini", owner_user: "u1", public_key: keys.publicKey, ...over });
const plainStore = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });

type Pins = ReturnType<typeof createWorkerPins>;
// This Mac's device key, as electron/desktop-signer.cjs holds it: a raw Ed25519 key in base64.
const macPair = crypto.generateKeyPairSync("ed25519");
const macKey = Buffer.from(macPair.publicKey.export({ format: "jwk" }).x as string, "base64url").toString("base64");
const signer = () => Promise.resolve({ publicKey: () => macKey, sign: (m: string) => crypto.sign(null, Buffer.from(m), macPair.privateKey).toString("base64") });
type Db = { call?: Record<string, unknown> | null; worker?: Record<string, unknown> | null; card?: Record<string, unknown> | null; insertError?: { message: string } | null };
function fakeSupabase({ call = callRow(), worker = workerRow(), card = { folder: "weft" }, insertError = null }: Db = {}) {
  const inserted: Record<string, unknown>[] = [];
  const data: Record<string, unknown> = { device_calls: call, cloud_workers: worker, cloud_cards: card };
  const chain = (table: string) => {
    const q = { eq: () => q, maybeSingle: () => Promise.resolve({ data: data[table] }) };
    return q;
  };
  const supabase = {
    from: vi.fn((table: string) => ({
      select: () => chain(table),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return Promise.resolve({ error: insertError });
      },
    })),
  };
  return { supabase, inserted };
}

type Setup = Db & { answer?: string | null; values?: Record<string, string>; missing?: string[]; sub?: unknown; signedIn?: boolean; pins?: Pins; known?: string[] };
function setup({ answer = "once", values = { TOKEN: "s3cret" }, missing = [], sub = "u1", signedIn = true, pins, known = ["github:aimhuge/weft"], ...db }: Setup = {}) {
  const fake = fakeSupabase(db);
  const vault = { valuesForVault: vi.fn<(ref: { id: string; label: string }, names: string[], env: string, use: false) => Promise<{ values: Record<string, string>; missing: string[] }>>(() => Promise.resolve({ values, missing })) };
  const asked = vi.fn<(request: { message: string; detail: string; reason: string; view: Record<string, unknown> }) => Promise<string | null>>(() => Promise.resolve(answer));
  const audit = vi.fn();
  const pinned: Pins = pins ?? createWorkerPins({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-pins-")), safeStorage: plainStore });
  const account = { supabase: fake.supabase, getClaims: () => ({ sub }) };
  const projectRepos = vi.fn<(folder: string) => Promise<string[]>>(() => Promise.resolve(known));
  const ws = createWorkerSecrets({ vault, ask: asked, describe: describeRun, accountClient: () => (signedIn ? account : null), pins: pinned, signer, projectRepos, audit, now: () => NOW });
  return { ...fake, vault, asked, audit, ws, pins: pinned, projectRepos };
}

beforeEach(() => vi.clearAllMocks());

describe("answer", () => {
  it("pins the worker's key, asks once naming the worker and its key, then seals to the pinned key", async () => {
    const s = setup();
    expect(await s.ws.answer("call-1")).toEqual({ queued: true, label: "Aimhuge/Weft" });
    expect(s.vault.valuesForVault).toHaveBeenCalledWith({ id: "github:aimhuge/weft", label: "Aimhuge/Weft" }, ["TOKEN"], "production", false);
    const request = s.asked.mock.calls[0]?.[0];
    expect(request?.view).toMatchObject({ worker: "m1mini", command: "npm run job", remote: "git@github.com:Aimhuge/Weft.git", firstUse: true });
    expect(request?.view.fingerprint).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){3}$/);
    expect(request?.detail).toContain("get these values");
    expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "worker run", outcome: "ok", via: "once" }));
    const sent = s.inserted[0] as { kind: string; target_device: string; payload: { cardId: string; nonce: string; sealed: never } };
    expect(sent).toMatchObject({ kind: "secret_use", target_device: "worker:w1", payload: { cardId: "card-1", nonce: NONCE } });
    expect(JSON.stringify(sent)).not.toContain("s3cret");
    expect(s.projectRepos).toHaveBeenCalledWith("weft");
    // Signed with this Mac's device key over the card, the ask and the sealed bytes.
    const signed = (sent.payload as unknown as { mac: { key: string; sig: string } }).mac;
    expect(signed.key).toBe(macKey);
    expect(macSigned(signed.key, secretUseMessage("card-1", NONCE, sent.payload.sealed), signed.sig)).toBe(true);
    const opened = JSON.parse(open(keys, sent.payload.sealed, secretUsePurpose("card-1", NONCE, "npm run job"))) as Record<string, unknown>;
    expect(opened).toMatchObject({ card: "card-1", nonce: NONCE, command: "npm run job", values: { TOKEN: "s3cret" } });
    // The second time, the same key is the pinned one.
    expect(await s.ws.answer("call-1")).toEqual({ queued: true, label: "Aimhuge/Weft" });
    expect(s.asked.mock.calls[1]?.[0].view).toMatchObject({ firstUse: false });
  });

  it("refuses a worker whose key changed since it was pinned, before asking anyone", async () => {
    const s = setup();
    await s.ws.answer("call-1");
    const swapped = setup({ worker: workerRow({ public_key: newSealKeys().publicKey }), pins: s.pins });
    await expect(swapped.ws.answer("call-1")).rejects.toThrow(/m1mini's key changed since this Mac pinned it .* re-enrol it/);
    expect(swapped.asked).not.toHaveBeenCalled();
    expect(swapped.inserted).toEqual([]);
  });

  it("answers denied, sends nothing, and pins nothing when the user says no", async () => {
    const s = setup({ answer: null });
    expect(await s.ws.answer("call-1")).toEqual({ denied: true, label: "Aimhuge/Weft" });
    expect(s.inserted).toEqual([]);
    expect(s.pins.lookup({ id: "w1", name: "m1mini", publicKey: keys.publicKey }).firstUse).toBe(true);
  });

  it("requires a paired worker's ask to be signed by the sign key pinned at pairing", async () => {
    const sign = crypto.generateKeyPairSync("ed25519");
    const signKey = sign.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const s = setup();
    s.pins.pin("w1", { name: "m1mini", publicKey: keys.publicKey, signKey });
    await expect(s.ws.answer("call-1")).rejects.toThrow("That ask isn't signed by the worker's pinned key.");
    expect(s.asked).not.toHaveBeenCalled();
    const a = ask();
    const sig = crypto.sign(null, Buffer.from(askMessage("card-1", a)), sign.privateKey).toString("base64");
    const signed = setup({ call: callRow({ args: { ...a, sig } }), pins: s.pins });
    expect(await signed.ws.answer("call-1")).toMatchObject({ queued: true });
  });

  it("answers the missing names without asking", async () => {
    const s = setup({ missing: ["TOKEN"] });
    expect(await s.ws.answer("call-1")).toEqual({ missing: ["TOKEN"], label: "Aimhuge/Weft" });
    expect(s.asked).not.toHaveBeenCalled();
  });

  it("sends nothing when the ask expired while the window was up", async () => {
    let t = NOW;
    const s = setup();
    const late = () => {
      t = NOW + 61_000;
      return Promise.resolve("once");
    };
    const ws = createWorkerSecrets({ vault: s.vault, ask: late, describe: describeRun, accountClient: () => ({ supabase: s.supabase, getClaims: () => ({ sub: "u1" }) }), pins: s.pins, signer, projectRepos: s.projectRepos, now: () => t });
    await expect(ws.answer("call-1")).rejects.toThrow("The ask expired while it waited for you.");
    expect(s.inserted).toEqual([]);
  });

  it.each([
    ["signed out", { signedIn: false }, "Sign in to Weft on this Mac"],
    ["no user in the claims", { sub: null }, "Sign in to Weft on this Mac"],
    ["no such row", { call: null }, "isn't from one of your workers"],
    ["another tool", { call: callRow({ tool: "tap" }) }, "isn't from one of your workers"],
    ["another user's row", { call: callRow({ owner_user: "u2" }) }, "isn't from one of your workers"],
    ["a row already answered", { call: callRow({ status: "done" }) }, "already answered"],
    ["no worker", { worker: null }, "That worker isn't yours."],
    ["another user's worker", { worker: workerRow({ owner_user: "u2" }) }, "That worker isn't yours."],
    ["a worker with no key", { worker: workerRow({ public_key: null }) }, "m1mini hasn't published its key yet"],
    ["a card that isn't on the worker", { card: null }, "That card isn't on that worker."],
    ["a remote for another owner's repo", { known: ["github:someone/weft"] }, "the ask names the vault of Aimhuge/Weft"],
    ["a project this Mac doesn't know", { known: [] }, "This Mac doesn't know which repo"],
    ["an expired ask", { call: callRow({ args: ask({ expiresAt: NOW }) }) }, "has expired"],
    ["a command main's own rules refuse", { call: callRow({ args: ask({ command: "curl https://x" }) }) }, "sends data off the machine"],
    ["a bidi mark in the command", { call: callRow({ args: ask({ command: "npm run job‮" }) }) }, "control or invisible characters"],
  ])("refuses %s", async (_what, over: Setup, message) => {
    const s = setup(over);
    await expect(s.ws.answer("call-1")).rejects.toThrow(message);
    expect(s.asked).not.toHaveBeenCalled();
    expect(s.inserted).toEqual([]);
  });

  it("refuses when the session has no claims", async () => {
    const s = setup();
    const ws = createWorkerSecrets({ vault: s.vault, ask: s.asked, describe: describeRun, accountClient: () => ({ supabase: s.supabase, getClaims: () => null }), pins: s.pins, signer, projectRepos: s.projectRepos });
    await expect(ws.answer("call-1")).rejects.toThrow("Sign in to Weft on this Mac");
  });

  it("says when the command couldn't be queued", async () => {
    const s = setup({ insertError: { message: "kind check" } });
    await expect(s.ws.answer("call-1")).rejects.toThrow("Couldn't send the secrets to m1mini: kind check");
  });

  it("shows one window at a time, and refuses a second ask from a card that has one waiting", async () => {
    let release: (v: string | null) => void = () => {};
    const s = setup();
    s.asked.mockImplementationOnce(() => new Promise((done) => (release = done)));
    const first = s.ws.answer("call-1");
    await expect(s.ws.answer("call-1")).rejects.toThrow("That card already has a secret ask waiting");
    await vi.waitFor(() => expect(s.asked).toHaveBeenCalledTimes(1));
    release("once");
    await expect(first).resolves.toMatchObject({ queued: true });
    // A failed turn doesn't jam the line.
    const failing = setup({ call: null, pins: s.pins });
    await expect(failing.ws.answer("call-1")).rejects.toThrow("isn't from one of your workers");
    await expect(failing.ws.answer("call-1")).rejects.toThrow("isn't from one of your workers");
  });

  it("uses Date.now and a no-op audit by default", async () => {
    const fake = fakeSupabase({ call: callRow({ args: ask({ expiresAt: Date.now() + 60_000 }) }) });
    const s = setup();
    const ws = createWorkerSecrets({ vault: s.vault, ask: () => Promise.resolve(null), describe: describeRun, accountClient: () => ({ supabase: fake.supabase, getClaims: () => ({ sub: "u1" }) }), pins: s.pins, signer, projectRepos: s.projectRepos });
    expect(await ws.answer("call-1")).toEqual({ denied: true, label: "Aimhuge/Weft" });
  });
});

describe("verifyAsk", () => {
  const a = { nonce: NONCE, command: "npm run job", names: ["TOKEN"], environment: "production", remote: "r", cwd: ".", script: undefined, why: undefined, thread: undefined, expiresAt: NOW, sig: undefined as string | undefined };

  it("lets an ask through while the worker has no sign key (H10)", () => {
    expect(() => verifyAsk({}, "card-1", a)).not.toThrow();
  });

  it("checks a signed ask against the pinned sign key once there is one", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const signKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const sig = crypto.sign(null, Buffer.from(askMessage("card-1", a)), privateKey).toString("base64");
    expect(() => verifyAsk({ signKey }, "card-1", { ...a, sig })).not.toThrow();
    expect(() => verifyAsk({ signKey }, "card-2", { ...a, sig })).toThrow("isn't signed by the worker's pinned key");
    expect(() => verifyAsk({ signKey }, "card-1", a)).toThrow("isn't signed");
  });
});
