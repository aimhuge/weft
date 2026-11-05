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

// Standard base64 (with padding), the form every key and ciphertext is stored in: @weft/client's, so the phone's
// libsodium encodes the same way.
export { b64, unb64 } from "@weft/client";
