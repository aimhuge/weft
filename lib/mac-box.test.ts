import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createDesktopSigner } from "../electron/desktop-signer.cjs";
import { fakeSafeStorage } from "../electron/pairing.harness";
import { sealToMac } from "./mac-box";
import { sodium, type Sodium } from "./sodium";

let s: Sodium;
beforeAll(async () => {
  s = await sodium();
});

const signerAt = () => createDesktopSigner({ dir: fs.mkdtempSync(path.join(os.tmpdir(), "weft-mac-box-")), safeStorage: fakeSafeStorage, sodium: () => s });

describe("sealToMac", () => {
  it("seals to the Mac's Ed25519 key so only that Mac's main opens it", async () => {
    const mac = signerAt();
    const sealed = await sealToMac(mac.publicKey(), "a generated secret");
    expect(sealed).not.toContain("generated");
    expect(mac.openBox(sealed)).toBe("a generated secret");
    expect(() => signerAt().openBox(sealed)).toThrow();
  });

  it("refuses a key that isn't 32 bytes", async () => {
    await expect(sealToMac(Buffer.from("short").toString("base64"), "x")).rejects.toThrow("isn't one it can seal to");
  });
});
