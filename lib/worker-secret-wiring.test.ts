import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as cjs from "../electron/worker-seal.cjs";
import { macSigner } from "./mac-signer.harness";
import { secretUsePurpose } from "./secret-use";
import { openAsk } from "./worker-secret-asks";
import { connectorMessage, connectorPurpose } from "./connector-wire";
import { forgetMacs, keyStatus, secretWiring, withShims } from "./worker-secret-wiring";
import { newSealKeys, sealFingerprint, type Sealed } from "./worker-seal";
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

describe("keyStatus", () => {
  it("shows the box key's fingerprint, whether asks are signed, and the Macs it trusts", () => {
    const { h } = pairedHome();
    const keys = newSealKeys();
    fs.writeFileSync(path.join(h, "seal-key.json"), JSON.stringify(keys));
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify(["k1"]));
    expect(keyStatus(h)).toEqual([
      `Box key fingerprint: ${sealFingerprint(keys.publicKey)} (your Mac shows the same when it asks for secrets)`,
      "Secret asks are signed with this box's pairing key.",
      "Takes secrets from the Mac it was paired with (weft-worker forget-macs to stop).",
      "Google Workspace (gog): off",
      "GitHub (gh): off",
    ]);
  });

  it("says when there's no key yet, no pairing, and no Mac", () => {
    const h = home();
    expect(keyStatus(h)).toEqual(["No box key yet: it's made when the worker first starts.", "Secret asks aren't signed (enrolled by token, not paired).", "Takes no secrets: enrolled by token. Pair it from Settings → Devices → Add a worker to use secrets.", "Google Workspace (gog): off", "GitHub (gh): off"]);
    fs.writeFileSync(path.join(h, "seal-key.json"), JSON.stringify({ publicKey: 5 }));
    expect(keyStatus(h)[0]).toBe("Secret asks aren't signed (enrolled by token, not paired).");
  });
});

describe("the vault link and connectors", () => {
  it("sets the vault link with the pairing signer and the paired Mac, and puts the shims first on the search path", async () => {
    const { h } = pairedHome();
    const mac = macSigner();
    fs.writeFileSync(path.join(h, "mac-keys.json"), JSON.stringify([mac.key]));
    const keys = newSealKeys();
    const real = fs.mkdtempSync(path.join(os.tmpdir(), "weft-real-"));
    fs.writeFileSync(path.join(real, "gh"), "#!/bin/sh\n", { mode: 0o755 });
    const shims = path.join(h, "connectors", "bin");
    const w = secretWiring(h, reg, keys, [shims, real, ""].join(path.delimiter));
    expect(w.shimmed).toBe([shims, real].join(path.delimiter));
    expect(withShims(h, "").shimmed).toBe(shims);
    const ask = vi.fn(() => Promise.resolve({ label: "o/r", secrets: [] }));
    await listOnWorker("c1", h, { ask, remote: () => Promise.resolve("r") });
    const args = (ask.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
    expect(typeof args.sig).toBe("string");
    // set_value seals to the Mac this box was paired with.
    const seal = vi.fn((key: string) => Promise.resolve(`to ${key}`));
    await setOnWorker("c1", h, { name: "S", value: "v", environment: "development" }, { ask, remote: () => Promise.resolve("r"), seal });
    expect(seal).toHaveBeenCalledWith(mac.key, expect.any(String));
    // A token the Mac lent goes through the same Mac keys, and the shim runs the real gh found past the shims.
    const nonce = "9".repeat(64);
    const issuedAt = Date.now();
    const sealed: Sealed = cjs.seal(keys.publicKey, JSON.stringify({ v: 1, connector: "gh", account: "octocat", token: "gho_abcdefghijklmnopqrstuvwxyz", expiresAt: issuedAt + 60_000, issuedAt }), connectorPurpose("gh", nonce));
    expect(w.connector({ payload: { op: "token", connector: "gh", nonce, issuedAt, sealed, mac: { key: mac.key, sig: mac.sign(connectorMessage("token", "gh", nonce, issuedAt, sealed)) } } } as never)).toBeNull();
    expect(fs.readFileSync(path.join(shims, "gh"), "utf8")).toContain("connector-exec.cjs");
    expect(keyStatus(h).at(-1)).toMatch(/^GitHub \(gh\): octocat, until /);
    setVaultLink(null);
  });
});
