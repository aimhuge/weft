// The one libsodium for Weft's TypeScript side, on the Mac's server and in the browser alike
// (docs/architecture/mobile-security.md). Electron main loads the same package from electron/vault-crypto.cjs, and the
// phone app uses react-native-libsodium: every primitive here is one the three share, so they compute the same bytes.
import sodiumModule from "libsodium-wrappers";

export type Sodium = typeof sodiumModule;

// Ready libsodium. Its WebAssembly loads once; later calls return at once.
export async function sodium(): Promise<Sodium> {
  await sodiumModule.ready;
  return sodiumModule;
}

// Standard base64 (with padding), the form every key and ciphertext is stored in.
export const b64 = (s: Sodium, bytes: Uint8Array) => s.to_base64(bytes, s.base64_variants.ORIGINAL);
export const unb64 = (s: Sodium, text: string) => s.from_base64(text, s.base64_variants.ORIGINAL);
