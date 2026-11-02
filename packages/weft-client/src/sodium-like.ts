// The libsodium calls the package makes, as a shape rather than a module: lib/sodium.ts's libsodium-wrappers and the
// phone's react-native-libsodium both fit it, so the package signs and checks the same bytes on either without
// importing a WebAssembly build of its own.
export interface Sodium {
  readonly base64_variants: { readonly ORIGINAL: number };
  to_base64(input: Uint8Array, variant: number): string;
  from_base64(input: string, variant: number): Uint8Array;
  from_string(input: string): Uint8Array;
  to_hex(input: Uint8Array): string;
  crypto_generichash(hashLength: number, message: Uint8Array): Uint8Array;
  crypto_sign_detached(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
  crypto_sign_verify_detached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
}

// Standard base64 (with padding), the form every key and ciphertext is stored in.
export const b64 = (s: Sodium, bytes: Uint8Array) => s.to_base64(bytes, s.base64_variants.ORIGINAL);
export const unb64 = (s: Sodium, text: string) => s.from_base64(text, s.base64_variants.ORIGINAL);
