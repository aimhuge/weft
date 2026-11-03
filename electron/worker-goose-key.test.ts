// Main's side of a worker card's Goose key (electron/worker-goose-key.cjs): it reads the row itself, needs the pinned sign
// key's signature, answers only for the provider and endpoint this Mac last set on that worker, asks Touch ID naming the
// worker and provider, and sends the key only sealed to the pinned box key as a Mac-signed secret_use marked "goose".
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createWorkerPins } from "./worker-pins.cjs";
import { createWorkerGooseKey, gooseKeyAskOf, gooseKeyReason } from "./worker-goose-key.cjs";
import { createAskNonces } from "./worker-vault-guards.cjs";
import { gooseKeyAskMessage, gooseKeyCommand, gooseKeyPurpose } from "../lib/worker-goose-key-wire";
import { openedUse, secretUseMessage } from "../lib/secret-use";
import { newSealKeys, open, type Sealed } from "../lib/worker-seal";

const NOW = 1_000_000;
const NONCE = "d".repeat(64);
const keys = newSealKeys();
const pair = crypto.generateKeyPairSync("ed25519");
const SIGN_KEY = pair.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const mac = crypto.generateKeyPairSync("ed25519");
const MAC_KEY = mac.publicKey.export({ format: "der", type: "spki" }).toString("base64");
const URL = "https://api-cli.puku.sh";
const plainStore = () => ({ encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() });

const base = (over: Record<string, unknown> = {}) => ({ nonce: NONCE, expiresAt: NOW + 60_000, providerId: "anthropic", baseUrl: URL, ...over });
const signed = (a: Record<string, unknown>, card = "card-1") => ({ ...a, sig: crypto.sign(null, Buffer.from(gooseKeyAskMessage(card, keys.publicKey, a as never)), pair.privateKey).toString("base64") });

function pinned(signKey: string | null = SIGN_KEY) {
  const pins = createWorkerPins({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-goose-pins-")), safeStorage: plainStore });
  pins.pin("w1", { name: "m1mini", publicKey: keys.publicKey, ...(signKey ? { signKey } : {}) });
  return pins;
}

type Setup = { args?: Record<string, unknown>; set?: { providerId: string; baseUrl: string } | null; key?: { token: string; baseUrl?: string } | null; allow?: boolean; pins?: ReturnType<typeof createWorkerPins>; insertError?: string; now?: () => number };
function setup({ args, set = { providerId: "anthropic", baseUrl: URL }, key = { token: "sk-ant-secret-123", baseUrl: URL }, allow = true, pins = pinned(), insertError, now = () => NOW }: Setup = {}) {
  const row = { id: "call-1", org_id: "org-1", owner_user: "u1", worker_id: "w1", card_id: "card-1", tool: "goose_key", args: args ?? signed(base()), status: "claimed" };
  const data: Record<string, unknown> = { device_calls: row, cloud_workers: { id: "w1", name: "m1mini", owner_user: "u1", public_key: keys.publicKey, sign_key: SIGN_KEY }, cloud_cards: { folder: "weft", title: "Fix the build" } };
  const inserted: Record<string, unknown>[] = [];
  const chain = (table: string) => {
    const q = { eq: () => q, maybeSingle: () => Promise.resolve({ data: data[table] }) };
    return q;
  };
  const supabase = {
    from: (table: string) => ({
      select: () => chain(table),
      insert: (r: Record<string, unknown>) => {
        inserted.push(r);
        return Promise.resolve({ error: insertError ? { message: insertError } : null });
      },
    }),
  };
  const confirm = vi.fn(() => Promise.resolve(allow));
  const readKey = vi.fn(() => key);
  const cardOrigin = vi.fn(() => Promise.resolve());
  const audit = vi.fn();
  const signer = () => Promise.resolve({ publicKey: () => MAC_KEY, sign: (m: string) => crypto.sign(null, Buffer.from(m), mac.privateKey).toString("base64") });
  const gk = createWorkerGooseKey({ accountClient: () => ({ supabase, getClaims: () => ({ sub: "u1" }) }), pins, signer, confirm, readKey, lastSet: { of: (w: string) => (w === "w1" ? set : null) }, nonces: createAskNonces({ now }), cardOrigin, audit, now });
  return { gk, confirm, readKey, cardOrigin, audit, inserted };
}

describe("createWorkerGooseKey", () => {
  it("seals the key to the pinned box key for this card, ask, provider and endpoint, signed by this Mac", async () => {
    const s = setup();
    expect(await s.gk.answer("call-1")).toEqual({ queued: true, label: "Anthropic" });
    expect(s.confirm).toHaveBeenCalledWith(`send your Anthropic key to the worker m1mini for one Goose turn of "Fix the build", to the endpoint ${URL}. Any code that turn runs there can read it.`);
    expect(s.cardOrigin).toHaveBeenCalledWith(expect.anything(), "u1", "w1", "card-1", "weft");
    const command = s.inserted[0] as { kind: string; target_device: string; payload: { cardId: string; nonce: string; sealed: Sealed; mac: { key: string; sig: string }; use: string } };
    expect(command).toMatchObject({ kind: "secret_use", target_device: "worker:w1", payload: { cardId: "card-1", nonce: NONCE, use: "goose" } });
    const { sealed, mac: by } = command.payload;
    expect(crypto.verify(null, Buffer.from(secretUseMessage("card-1", NONCE, sealed)), mac.publicKey, Buffer.from(by.sig, "base64"))).toBe(true);
    const opened = openedUse(open(keys, sealed, gooseKeyPurpose("card-1", NONCE, gooseKeyCommand("anthropic", URL))));
    expect(opened).toEqual({ card: "card-1", nonce: NONCE, command: gooseKeyCommand("anthropic", URL), names: ["ANTHROPIC_API_KEY"], environment: "production", expiresAt: NOW + 60_000, values: { ANTHROPIC_API_KEY: "sk-ant-secret-123" } });
    // Not under a run's or a dev server's purpose, nor another endpoint's.
    expect(() => open(keys, sealed, gooseKeyPurpose("card-1", NONCE, gooseKeyCommand("anthropic", "https://evil.example")))).toThrow();
    expect(s.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "worker goose key", worker: "m1mini", outcome: "ok" }));
    expect(JSON.stringify(s.audit.mock.calls)).not.toContain("sk-ant-secret-123");
    // The same signed ask copied into a new row is answered once only.
    await expect(s.gk.answer("call-1")).rejects.toThrow("already answered");
  });

  it("refuses a provider or endpoint this Mac didn't last set for that worker, before reading the key or asking", async () => {
    for (const set of [null, { providerId: "openai", baseUrl: URL }, { providerId: "anthropic", baseUrl: "" }]) {
      const s = setup({ set });
      await expect(s.gk.answer("call-1")).rejects.toThrow("an endpoint this Mac didn't set for it");
      expect(s.readKey).not.toHaveBeenCalled();
      expect(s.confirm).not.toHaveBeenCalled();
      expect(s.inserted).toEqual([]);
    }
  });

  it("refuses an ask that isn't signed by the pinned key, or from a worker with none pinned", async () => {
    const forged = setup({ args: { ...signed(base()), baseUrl: "https://evil.example" } });
    await expect(forged.gk.answer("call-1")).rejects.toThrow("isn't signed by the worker's pinned key");
    const other = setup({ args: signed(base(), "card-2") });
    await expect(other.gk.answer("call-1")).rejects.toThrow("isn't signed");
    const unpaired = setup({ pins: pinned(null) });
    await expect(unpaired.gk.answer("call-1")).rejects.toThrow("no pinned signing key");
    expect(unpaired.confirm).not.toHaveBeenCalled();
  });

  it("says when no key is saved, sends nothing on a No, and refuses an ask that expired while it waited", async () => {
    const none = setup({ key: null });
    expect(await none.gk.answer("call-1")).toEqual({ none: true, label: "Anthropic" });
    expect(none.confirm).not.toHaveBeenCalled();
    const no = setup({ allow: false });
    expect(await no.gk.answer("call-1")).toEqual({ denied: true, label: "Anthropic" });
    expect(no.inserted).toEqual([]);
    expect(no.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }));
    let t = NOW;
    const late = setup({ now: () => t });
    late.confirm.mockImplementationOnce(() => {
      t = NOW + 120_000;
      return Promise.resolve(true);
    });
    await expect(late.gk.answer("call-1")).rejects.toThrow("expired while it waited");
    expect(late.inserted).toEqual([]);
  });

  it("says so when the sealed key can't be sent, and still answers the next ask", async () => {
    const s = setup({ insertError: "rls" });
    await expect(s.gk.answer("call-1")).rejects.toThrow("Couldn't send the secrets to m1mini: rls");
    await expect(s.gk.answer("call-1")).rejects.toThrow("already answered");
  });
});

describe("createWorkerGooseKey after a Re-pin", () => {
  it("names the new box key in Touch ID and pins it once the user allows", async () => {
    const pins = createWorkerPins({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-goose-pins-")), safeStorage: plainStore });
    pins.pin("w1", { name: "m1mini", publicKey: "old-box", signKey: SIGN_KEY });
    pins.forget("w1");
    const s = setup({ pins });
    expect(await s.gk.answer("call-1")).toEqual({ queued: true, label: "Anthropic" });
    expect(s.confirm).toHaveBeenCalledWith(expect.stringContaining("is new to this Mac and gets pinned"));
    expect(pins.lookup({ id: "w1", name: "m1mini", publicKey: keys.publicKey })).toMatchObject({ firstUse: false, signKey: SIGN_KEY });
  });
});

describe("gooseKeyAskOf", () => {
  it("takes a catalog provider that uses a key and a plain endpoint, and nothing else", () => {
    expect(gooseKeyAskOf({ ...base({ baseUrl: "" }), thread: "T", sig: "s" }, NOW)).toMatchObject({ nonce: NONCE, baseUrl: "", thread: "T", sig: "s", provider: { id: "anthropic" } });
    expect(gooseKeyAskOf(base({ sig: 5 }), NOW).sig).toBeUndefined();
    for (const bad of [null, [], base({ nonce: "x" }), base({ providerId: "nope" }), base({ providerId: "ollama" }), base({ providerId: 3 }), base({ baseUrl: 5 })]) expect(() => gooseKeyAskOf(bad, NOW)).toThrow("isn't one Weft makes");
    expect(() => gooseKeyAskOf(base({ baseUrl: "https://a‮.b" }), NOW)).toThrow("can't show plainly");
    expect(() => gooseKeyAskOf(base({ expiresAt: NOW - 1 }), NOW)).toThrow("expired");
  });
});

describe("gooseKeyReason", () => {
  it("names the provider's own endpoint when none is set, and says when it differs from the one the key was saved for", () => {
    const provider = { label: "OpenAI" };
    expect(gooseKeyReason({ worker: "m1", provider, baseUrl: "", saved: undefined, card: "" })).toBe("send your OpenAI key to the worker m1 for one Goose turn, to OpenAI's own endpoint. Any code that turn runs there can read it.");
    expect(gooseKeyReason({ worker: "m1", provider, baseUrl: "https://b", saved: "https://a", card: "C" })).toContain('of "C", to the endpoint https://b (the key was saved for https://a)');
  });
});
