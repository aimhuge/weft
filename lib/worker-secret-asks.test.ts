import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { macSigner, memoryMacs } from "./mac-signer.harness";
import { secretUsePurpose } from "./secret-use";
import { deliverSecretUse, openAsk, openAsks, type OpenAsk } from "./worker-secret-asks";
import { newSealKeys, open, type Sealed } from "./worker-seal";

const keys = newSealKeys();
const signer = macSigner();
// The Mac this box was paired with: its key came in the pairing code (lib/worker-mac-keys.ts trustPairingMac).
let macs = memoryMacs([signer.key]);
const opener = (sealed: Sealed, purpose: string) => open(keys, sealed, purpose);
const NOW = 1_000_000;
let n = 0;
let nonce: string;
let ask: OpenAsk;

const plain = (over: Record<string, unknown> = {}) => ({ v: 1, card: "c1", nonce, command: "npm run job", names: ["A", "B"], environment: "development", expiresAt: NOW + 60_000, values: { A: "va", B: "vb" }, ...over });
// What main sends: sealed to this worker for the purpose the plaintext names, unless told otherwise.
function row(over: Record<string, unknown> = {}, purpose?: string, payload: Record<string, unknown> = {}) {
  const p = plain(over);
  const sealed = cjs.seal(keys.publicKey, JSON.stringify(p), purpose ?? secretUsePurpose(p.card, p.nonce, p.command));
  return { payload: { cardId: "c1", nonce, sealed, mac: signer.mac(typeof payload.cardId === "string" ? payload.cardId : "c1", nonce, sealed), ...payload } };
}

beforeEach(() => {
  macs = memoryMacs([signer.key]);
  nonce = String(++n).padStart(64, "0");
  ask = openAsk(nonce, { cardId: "c1", command: "npm run job", names: ["B", "A"], environment: "development", expiresAt: NOW + 60_000 });
});

afterEach(() => ask.drop());

describe("openAsk", () => {
  it("takes one ask per card at a time", () => {
    expect(() => openAsk("f".repeat(64), { cardId: "c1", command: "x", names: ["A"], environment: "development", expiresAt: NOW })).toThrow("This card already has a secret ask waiting on your Mac.");
    const other = openAsk("e".repeat(64), { cardId: "c2", command: "x", names: ["A"], environment: "development", expiresAt: NOW });
    other.drop();
  });
});

describe("deliverSecretUse", () => {
  it("takes only a row signed by the Mac it was paired with", () => {
    const unsigned = row();
    delete (unsigned.payload as { mac?: unknown }).mac;
    expect(() => deliverSecretUse(unsigned, opener, macs, NOW)).toThrow("That secret use isn't signed by a Mac.");
    const forged = row();
    forged.payload.mac = { key: signer.key, sig: signer.sign("something else") };
    expect(() => deliverSecretUse(forged, opener, macs, NOW)).toThrow("That secret use's Mac signature doesn't check out.");
  });

  it("refuses a row a session sealed and signed with its own key, even before the real answer, and keeps the ask open", async () => {
    // Anyone with the owner's session can read the nonce and the worker's public key, seal values and sign the row.
    const session = macSigner();
    const sealed = cjs.seal(keys.publicKey, JSON.stringify(plain()), secretUsePurpose("c1", nonce, "npm run job"));
    const forged = { payload: { cardId: "c1", nonce, sealed, mac: session.mac("c1", nonce, sealed) } };
    expect(() => deliverSecretUse(forged, opener, macs, NOW)).toThrow("That secret use is signed by a Mac this worker wasn't paired with.");
    expect(macs.keys).toEqual([signer.key]);
    // The real Mac's answer still lands.
    expect(deliverSecretUse(row(), opener, macs, NOW)).toBe("c1");
    await expect(ask.values).resolves.toEqual({ A: "va", B: "vb" });
  });

  it("takes no secrets on a box that trusts no Mac (enrolled by token)", () => {
    expect(() => deliverSecretUse(row(), opener, memoryMacs(), NOW)).toThrow("This worker trusts no Mac for secrets: it was enrolled by token.");
  });

  it("hands the values to the waiting ask once, and a replay finds nothing", async () => {
    const before = openAsks();
    const command = row();
    expect(deliverSecretUse(command, opener, macs, NOW)).toBe("c1");
    await expect(ask.values).resolves.toEqual({ A: "va", B: "vb" });
    expect(openAsks()).toBe(before - 1);
    expect(() => deliverSecretUse(command, opener, macs, NOW)).toThrow(/already used, it expired, or it was never asked for/);
  });

  it("refuses an empty payload", () => {
    expect(() => deliverSecretUse({ payload: {} }, opener, macs, NOW)).toThrow("That secret use is empty.");
  });

  it("refuses one for another card, and leaves the ask open", async () => {
    expect(() => deliverSecretUse(row({}, undefined, { cardId: "c2" }), opener, macs, NOW)).toThrow("That secret use is for another card.");
    expect(deliverSecretUse(row(), opener, macs, NOW)).toBe("c1");
    await expect(ask.values).resolves.toEqual({ A: "va", B: "vb" });
  });

  it("refuses one sealed for another command or card: it doesn't open under this ask's purpose", () => {
    expect(() => deliverSecretUse(row({ command: "npm run other" }), opener, macs, NOW)).toThrow("That secret use wasn't sealed to this worker for this card's command.");
    expect(() => deliverSecretUse(row({ card: "c2" }), opener, macs, NOW)).toThrow("wasn't sealed to this worker");
    const other = newSealKeys();
    expect(() => deliverSecretUse(row(), (s, p) => open(other, s, p), macs, NOW)).toThrow("wasn't sealed to this worker");
  });

  it("refuses a plaintext that names another command, card or ask, even under the right purpose", () => {
    const purpose = secretUsePurpose("c1", nonce, "npm run job");
    expect(() => deliverSecretUse(row({ command: "rm -rf /" }, purpose), opener, macs, NOW)).toThrow("That secret use is for another command.");
    expect(() => deliverSecretUse(row({ card: "c2" }, purpose), opener, macs, NOW)).toThrow("That secret use is for another ask.");
    expect(() => deliverSecretUse(row({ nonce: "f".repeat(64) }, purpose), opener, macs, NOW)).toThrow("That secret use is for another ask.");
    expect(() => deliverSecretUse(row({ v: 2 }, purpose), opener, macs, NOW)).toThrow("That secret use is for another ask.");
  });

  it("refuses other names, another environment, or values that don't match the names", () => {
    expect(() => deliverSecretUse(row({ names: ["A"] }), opener, macs, NOW)).toThrow("That secret use names other secrets.");
    expect(() => deliverSecretUse(row({ environment: "production" }), opener, macs, NOW)).toThrow("That secret use names other secrets.");
    expect(() => deliverSecretUse(row({ values: { A: "va", C: "vc" } }), opener, macs, NOW)).toThrow("That secret use doesn't carry the values it names.");
  });

  it("refuses one whose sealed expiry has passed", () => {
    expect(() => deliverSecretUse(row({ expiresAt: NOW - 1 }), opener, macs, NOW)).toThrow("That secret use came after its ask expired.");
  });

  it("closes an expired ask and tells the waiting tool", async () => {
    expect(() => deliverSecretUse(row(), opener, macs, NOW + 60_001)).toThrow("That secret use came after its ask expired.");
    await expect(ask.values).rejects.toThrow("The approval came too late");
    expect(() => deliverSecretUse(row(), opener, macs, NOW)).toThrow(/never asked for/);
  });

  it("drop closes the ask", () => {
    ask.drop();
    expect(() => deliverSecretUse(row(), opener, macs, NOW)).toThrow(/never asked for/);
  });
});

describe("deliverSecretUse with values kept on this box", () => {
  const keptAsk = (id: string) => openAsk(id, { cardId: "k1", command: "npm run job", names: ["A", "B"], environment: "development", expiresAt: NOW + 60_000, repo: "github:o/r" });
  const keptRow = (id: string, over: Record<string, unknown> = {}) => {
    const p = { ...plain({ card: "k1", nonce: id, values: { B: "vb" }, kept: { A: 4 } }), ...over };
    const sealed = cjs.seal(keys.publicKey, JSON.stringify(p), secretUsePurpose("k1", id, "npm run job"));
    return { payload: { cardId: "k1", nonce: id, sealed, mac: signer.mac("k1", id, sealed) } };
  };

  it("opens the names the Mac said to take from here, at the versions it named, beside the values it sent", async () => {
    const id = "1".repeat(64);
    const waiting = keptAsk(id);
    const keptOpen = vi.fn(() => ({ A: "kept-a" }));
    expect(deliverSecretUse(keptRow(id), opener, macs, NOW, keptOpen)).toBe("k1");
    expect(keptOpen).toHaveBeenCalledWith("github:o/r", "development", { A: 4 });
    await expect(waiting.values).resolves.toEqual({ A: "kept-a", B: "vb" });
  });

  it("refuses a use that names a secret twice, or doesn't cover the names, and leaves the ask open", () => {
    const id = "2".repeat(64);
    const waiting = keptAsk(id);
    expect(() => deliverSecretUse(keptRow(id, { values: { A: "va", B: "vb" } }), opener, macs, NOW, () => ({}))).toThrow("That secret use names a secret twice.");
    expect(() => deliverSecretUse(keptRow(id, { kept: { C: 1 } }), opener, macs, NOW, () => ({}))).toThrow("doesn't carry the values it names");
    expect(() => deliverSecretUse(keptRow(id, { kept: { A: 0 } }), opener, macs, NOW, () => ({}))).toThrow("That secret use is for another ask.");
    waiting.drop();
  });

  it("fails the waiting tool at once when the kept copy can't be opened, or there's none here", async () => {
    const id = "3".repeat(64);
    const waiting = keptAsk(id);
    expect(() => deliverSecretUse(keptRow(id), opener, macs, NOW)).toThrow("it keeps none here");
    await expect(waiting.values).rejects.toThrow("it keeps none here");
    const id2 = "4".repeat(64);
    const second = keptAsk(id2);
    const broken = () => {
      throw new Error("This worker's kept copy of A won't open.");
    };
    expect(() => deliverSecretUse(keptRow(id2), opener, macs, NOW, broken)).toThrow("won't open");
    await expect(second.values).rejects.toThrow("won't open");
    expect(() => deliverSecretUse(keptRow(id2), opener, macs, NOW, broken)).toThrow(/never asked for/);
  });
});
