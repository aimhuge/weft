// Makes the server patches' signing key pair, once. Run it in your own terminal, not from a thread:
//   node scripts/server-patch-keygen.mjs
// It writes the public key into electron/patch-key.cjs (it ships in the app and checks every patch.json) and prints
// the private key one time, for 🔐 Add as WEFT_PATCH_SIGNING_KEY in the weft vault. Nothing else keeps it.
// A new pair means only apps built after it trust new patches. docs/architecture/updates.md#server-patches
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KEY_FILE = path.resolve(import.meta.dirname, "..", "electron", "patch-key.cjs");

export function keyModule(publicKeyB64) {
  return [
    "// The public half of the server patches' ed25519 signing key (base64 SPKI DER), written by",
    "// scripts/server-patch-keygen.mjs. electron/patcher.cjs takes only a patch.json signed by its private half,",
    "// WEFT_PATCH_SIGNING_KEY in the weft vault. null: no key yet, so this build takes no patches.",
    `module.exports = { PATCH_PUBLIC_KEY: ${JSON.stringify(publicKeyB64)} };`,
    "",
  ].join("\n");
}

function main() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  fs.writeFileSync(KEY_FILE, keyModule(pub));
  console.log(`Wrote the public key to ${path.relative(process.cwd(), KEY_FILE)}.\n`);
  console.log("Private key: add it in Weft's 🔐 vault as WEFT_PATCH_SIGNING_KEY, then clear this terminal.\n");
  console.log(privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main();
