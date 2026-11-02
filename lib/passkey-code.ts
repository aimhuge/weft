// The short code that ties a passkey pairing on sign.weft.zip to the Touch ID on the Mac (docs/architecture/
// mobile-security.md, "Pairing a passkey"): the first 4 bytes of SHA-256 of the passkey's public key (SPKI), as
// XXXX-XXXX. The page shows it while it waits; main puts the same code in its Touch ID prompt, so a claim someone else
// raced in (a software key, from a link they got hold of) shows a code that doesn't match the page. Main's copy is
// electron/pairing-crypto.cjs passkeyCode; electron/pairing-passkey.test.ts checks they agree.
import { fromB64url, sha256 } from "./passkey-verify";

export async function passkeyCode(publicKey: string): Promise<string> {
  const hex = [...(await sha256(fromB64url(publicKey))).subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}
