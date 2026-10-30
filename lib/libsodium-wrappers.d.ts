// Minimal type declaration for libsodium-wrappers, which ships without one: only what lib/sodium.ts uses
// (docs/architecture/mobile-security.md). Electron main uses the same package from plain CommonJS.
declare module "libsodium-wrappers" {
  interface Sodium {
    ready: Promise<void>;
    base64_variants: { ORIGINAL: number; URLSAFE_NO_PADDING: number };
    to_base64(bytes: Uint8Array, variant?: number): string;
    from_base64(text: string, variant?: number): Uint8Array;
    from_string(text: string): Uint8Array;
    to_string(bytes: Uint8Array): string;
    to_hex(bytes: Uint8Array): string;
    randombytes_buf(count: number): Uint8Array;
    crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
    crypto_aead_xchacha20poly1305_ietf_keygen(): Uint8Array;
    crypto_aead_xchacha20poly1305_ietf_encrypt(message: Uint8Array, ad: Uint8Array | null, secretNonce: null, nonce: Uint8Array, key: Uint8Array): Uint8Array;
    crypto_aead_xchacha20poly1305_ietf_decrypt(secretNonce: null, ciphertext: Uint8Array, ad: Uint8Array | null, nonce: Uint8Array, key: Uint8Array): Uint8Array;
    crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
    crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
    crypto_box_seal_open(ciphertext: Uint8Array, publicKey: Uint8Array, privateKey: Uint8Array): Uint8Array;
    crypto_sign_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
    crypto_sign_detached(message: Uint8Array, privateKey: Uint8Array): Uint8Array;
    crypto_sign_verify_detached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean;
    crypto_auth(message: Uint8Array, key: Uint8Array): Uint8Array;
    crypto_auth_verify(tag: Uint8Array, message: Uint8Array, key: Uint8Array): boolean;
    crypto_generichash(length: number, message: Uint8Array, key?: Uint8Array | null): Uint8Array;
    memcmp(a: Uint8Array, b: Uint8Array): boolean;
  }
  const sodium: Sodium;
  export default sodium;
}
