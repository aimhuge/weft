// set_value from a Weft Worker (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built): the
// value a thread generated travels to the owner's Mac sealed to that Mac's key, so Supabase and the device_calls row
// only ever hold sealed bytes. The worker trusts one Mac key, the Ed25519 one its pairing code carried
// (lib/worker-mac-keys.ts); libsodium turns it into the X25519 key a sealed box needs, and main opens it with the
// matching private half (electron/desktop-signer.cjs openBox). Nothing off the network chooses the key.
import { sodium } from "./sodium";

/** plaintext sealed to the Mac whose raw Ed25519 public key (base64) is macKey; base64 out. */
export async function sealToMac(macKey: string, plaintext: string): Promise<string> {
  const s = await sodium();
  const raw = Buffer.from(macKey, "base64");
  if (raw.length !== 32) throw new Error("This worker's Mac key isn't one it can seal to. Pair it again from Settings → Devices.");
  // In libsodium-wrappers' build but missing from its types.
  const convert = (s as unknown as { crypto_sign_ed25519_pk_to_curve25519: (key: Uint8Array) => Uint8Array }).crypto_sign_ed25519_pk_to_curve25519;
  const curve = convert(raw);
  return Buffer.from(s.crypto_box_seal(s.from_string(plaintext), curve)).toString("base64");
}
