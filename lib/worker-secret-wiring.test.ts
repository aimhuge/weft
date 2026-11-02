import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { macSigner } from "./mac-signer.harness";
import { secretUsePurpose } from "./secret-use";
import { openAsk } from "./worker-secret-asks";
import { forgetMacs, keyStatus, secretWiring } from "./worker-secret-wiring";
import { newSealKeys, sealFingerprint } from "./worker-seal";

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

  it("opens a signed secret_use with this box's seal key and trusts the Mac that sent it", async () => {
    const h = home();
    const keys = newSealKeys();
    const mac = macSigner();
    const nonce = "a".repeat(64);
    const ask = openAsk(nonce, { cardId: "wire-1", command: "npm run job", names: ["A"], environment: "development", expiresAt: Date.now() + 60_000 });
    const plain = { v: 1, card: "wire-1", nonce, command: "npm run job", names: ["A"], environment: "development", expiresAt: Date.now() + 60_000, values: { A: "x" } };
    const sealed = cjs.seal(keys.publicKey, JSON.stringify(plain), secretUsePurpose("wire-1", nonce, "npm run job"));
    const { use } = secretWiring(h, reg, keys);
    expect(use({ payload: { cardId: "wire-1", nonce, sealed, mac: mac.mac("wire-1", nonce, sealed) } } as never)).toBe("wire-1");
    await expect(ask.values).resolves.toEqual({ A: "x" });
    expect(JSON.parse(fs.readFileSync(path.join(h, "mac-keys.json"), "utf8"))).toEqual([mac.key]);
    forgetMacs(h);
    expect(fs.existsSync(path.join(h, "mac-keys.json"))).toBe(false);
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
      "Takes secrets from 1 Mac (weft-worker forget-macs to reset).",
    ]);
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify(["k1", "k2"]));
    expect(keyStatus(h)[2]).toBe("Takes secrets from 2 Macs (weft-worker forget-macs to reset).");
  });

  it("says when there's no key yet, no pairing, and no Mac", () => {
    const h = home();
    expect(keyStatus(h)).toEqual(["No box key yet: it's made when the worker first starts.", "Secret asks aren't signed (enrolled by token, not paired).", "Takes secrets from the first Mac that answers an ask."]);
    fs.writeFileSync(path.join(h, "seal-key.json"), JSON.stringify({ publicKey: 5 }));
    expect(keyStatus(h)[0]).toBe("Secret asks aren't signed (enrolled by token, not paired).");
  });
});
