import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { macSigner } from "./mac-signer.harness";
import { secretUsePurpose } from "./secret-use";
import { macKeysAt } from "./worker-mac-keys";
import { macFingerprint } from "./worker-repair";
import { keepMessage, keptPurpose } from "./worker-keep-wire";
import { openAsk } from "./worker-secret-asks";
import { forgetMacs, keyStatus, secretWiring } from "./worker-secret-wiring";
import { newSealKeys, sealFingerprint } from "./worker-seal";
import { listOnWorker, setOnWorker, setVaultLink } from "./worker-vault";

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), "weft-wiring-"));
const reg = { secretAsk: vi.fn(), deviceResult: vi.fn(), deviceCancel: vi.fn() };

function pairedHome() {
  const h = home();
  const pair = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(path.join(h, "sign-key.json"), JSON.stringify({ publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64"), privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64") }));
  return { h, pair };
}

describe("secretWiring", () => {
  it("signs asks with sign-key.json on a paired box, and not on a token-enrolled one", () => {
    const { h, pair } = pairedHome();
    const { link } = secretWiring(h, reg, newSealKeys());
    expect(link.ask).toBe(reg.secretAsk);
    const sig = link.sign?.("hello") ?? "";
    expect(crypto.verify(null, Buffer.from("hello"), pair.publicKey, Buffer.from(sig, "base64"))).toBe(true);
    expect(secretWiring(home(), reg, newSealKeys()).link.sign).toBeUndefined();
    const broken = home();
    fs.writeFileSync(path.join(broken, "sign-key.json"), JSON.stringify({ privateKey: 5 }));
    expect(secretWiring(broken, reg, newSealKeys()).link.sign).toBeUndefined();
    fs.writeFileSync(path.join(broken, "sign-key.json"), JSON.stringify({ privateKey: "bm90IGEga2V5" }));
    expect(secretWiring(broken, reg, newSealKeys()).link.sign).toBeUndefined();
  });

  it("opens a secret_use signed by the paired Mac with this box's seal key", async () => {
    const h = home();
    const keys = newSealKeys();
    const mac = macSigner();
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify([mac.key]));
    const nonce = "a".repeat(64);
    const ask = openAsk(nonce, { cardId: "wire-1", command: "npm run job", names: ["A"], environment: "development", expiresAt: Date.now() + 60_000 });
    const plain = { v: 1, card: "wire-1", nonce, command: "npm run job", names: ["A"], environment: "development", expiresAt: Date.now() + 60_000, values: { A: "x" } };
    const sealed = cjs.seal(keys.publicKey, JSON.stringify(plain), secretUsePurpose("wire-1", nonce, "npm run job"));
    const { use } = secretWiring(h, reg, keys);
    expect(use({ payload: { cardId: "wire-1", nonce, sealed, mac: mac.mac("wire-1", nonce, sealed) } } as never)).toBe("wire-1");
    await expect(ask.values).resolves.toEqual({ A: "x" });
    forgetMacs(h);
    expect(fs.existsSync(path.join(h, "mac-keys.json"))).toBe(false);
  });
});

describe("values the Mac keeps here", () => {
  it("stores a signed keep, claims it in asks, opens a kept value a secret_use names, and forgets it with the Mac", async () => {
    const h = home();
    const keys = newSealKeys();
    const mac = macSigner();
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify([mac.key]));
    const wiring = secretWiring(h, reg, keys, "w1");
    const keep = { worker: "w1", seq: 3, issuedAt: Date.now(), op: "put" as const, repo: "github:o/r", environment: "development", entries: [{ name: "A", version: 3, sealed: cjs.seal(keys.publicKey, "kept-a", keptPurpose("w1", "github:o/r", "development", "A", 3)) }] };
    expect(wiring.keep?.({ payload: { keep, mac: { key: mac.key, sig: mac.sign(keepMessage(keep)) } } } as never)).toEqual({ seq: 3, kept: 1 });
    expect(wiring.link.kept?.("github:o/r", "development", ["A", "B"])).toEqual({ A: 3 });
    expect(keyStatus(h)).toContain("Keeps secrets your Mac sent it (Keep on this worker), sealed to its box key; each use still needs your Mac's approval.");
    const nonce = "c".repeat(64);
    const ask = openAsk(nonce, { cardId: "wire-2", command: "npm run job", names: ["A", "B"], environment: "development", expiresAt: Date.now() + 60_000, repo: "github:o/r" });
    const plain = { v: 1, card: "wire-2", nonce, command: "npm run job", names: ["A", "B"], environment: "development", expiresAt: Date.now() + 60_000, values: { B: "sent-b" }, kept: { A: 3 } };
    const sealed = cjs.seal(keys.publicKey, JSON.stringify(plain), secretUsePurpose("wire-2", nonce, "npm run job"));
    expect(wiring.use({ payload: { cardId: "wire-2", nonce, sealed, mac: mac.mac("wire-2", nonce, sealed) } } as never)).toBe("wire-2");
    await expect(ask.values).resolves.toEqual({ A: "kept-a", B: "sent-b" });
    wiring.wipeKept?.();
    expect(wiring.link.kept?.("github:o/r", "development")).toEqual({});
    const again = { ...keep, seq: 4 };
    wiring.keep?.({ payload: { keep: again, mac: { key: mac.key, sig: mac.sign(keepMessage(again)) } } } as never);
    expect(fs.existsSync(path.join(h, "kept-vault.json"))).toBe(true);
    forgetMacs(h);
    expect(fs.existsSync(path.join(h, "kept-vault.json"))).toBe(false);
    expect(secretWiring(h, reg, keys).keep).toBeUndefined();
  });
});

describe("keyStatus", () => {
  it("shows the box key's fingerprint, whether asks are signed, and the Macs it trusts", () => {
    const { h } = pairedHome();
    const keys = newSealKeys();
    fs.writeFileSync(path.join(h, "seal-key.json"), JSON.stringify(keys));
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify(["k1"]));
    expect(keyStatus(h)).toEqual([
      `Box key fingerprint: ${sealFingerprint(keys.publicKey)} (your Mac shows the same when it asks for secrets)`,
      "Secret asks are signed with this box's pairing key.",
      `Takes secrets from the Mac it was paired with, key ${macFingerprint("k1")} (weft-worker forget-macs to stop).`,
    ]);
    // Revoked: named, and no longer trusted.
    macKeysAt(h).revoke(["k1"]);
    expect(keyStatus(h)[2]).toBe(`Takes no secrets: the Mac it was paired with (key ${macFingerprint("k1")}) was revoked. Wipe it and enrol it afresh from another Mac.`);
  });

  it("says when there's no key yet, no pairing, and no Mac", () => {
    const h = home();
    expect(keyStatus(h)).toEqual(["No box key yet: it's made when the worker first starts.", "Secret asks aren't signed (enrolled by token, not paired).", "Takes no secrets: enrolled by token. Pair it from Settings → Devices → Add a worker to use secrets."]);
    fs.writeFileSync(path.join(h, "seal-key.json"), JSON.stringify({ publicKey: 5 }));
    expect(keyStatus(h)[0]).toBe("Secret asks aren't signed (enrolled by token, not paired).");
  });
});

describe("the vault link", () => {
  it("is set with the pairing signer and the paired Mac", async () => {
    const { h } = pairedHome();
    const mac = macSigner();
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify([mac.key]));
    secretWiring(h, reg, newSealKeys());
    const ask = vi.fn(() => Promise.resolve({ label: "o/r", secrets: [] }));
    await listOnWorker("c1", h, { ask, remote: () => Promise.resolve("r") });
    const args = (ask.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(typeof args.sig).toBe("string");
    // set_value seals to the Mac this box was paired with.
    const seal = vi.fn((key: string) => Promise.resolve(`to ${key}`));
    await setOnWorker("c1", h, { name: "S", value: "v", environment: "development" }, { ask, remote: () => Promise.resolve("r"), seal });
    expect(seal).toHaveBeenCalledWith(mac.key, expect.any(String));
    setVaultLink(null);
  });
});
