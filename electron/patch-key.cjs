// The public half of the server patches' ed25519 signing key (base64 SPKI DER), written by
// scripts/server-patch-keygen.mjs. electron/patcher.cjs takes only a patch.json signed by its private half,
// WEFT_PATCH_SIGNING_KEY in the weft vault. null: no key yet, so this build takes no patches.
module.exports = { PATCH_PUBLIC_KEY: "MCowBQYDK2VwAyEA163PquhOGaMNfBJ9XYkVpHUeFHYPs7r+s4MyYa/Yv24=" };
