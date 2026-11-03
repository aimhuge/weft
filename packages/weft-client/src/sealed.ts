// A secret sealed to one Weft Worker (the app's lib/worker-seal.ts seals and opens it): an ephemeral X25519 public
// key, the AES-256-GCM iv, ciphertext and tag, each base64. Only the shape lives here, for the commands that carry one.
export interface Sealed {
  v: 1;
  epk: string;
  iv: string;
  ct: string;
  tag: string;
}
