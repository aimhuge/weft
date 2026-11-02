// The browser's passkey (docs/architecture/mobile-security.md, "Passkey approvals"): made once when this browser pairs
// with a Mac on sign.weft.zip, used for every Allow it signs there (never on weft.zip itself, lib/sign-origin.ts). The
// private key lives in the Secure Enclave (or the OS's passkey store) and the page only ever asks it for a signature,
// after Touch ID; WebAuthn binds it to sign.weft.zip, so no other site, weft.zip included, can use it. The host checks
// what it signs with electron/passkey-verify.cjs.
import { fromB64url, sha256, toB64url } from "./passkey-verify";

export interface BrowserPasskey {
  // Credential id and P-256 public key (SPKI), base64url.
  credId: string;
  publicKey: string;
}

const COSE_ES256 = -7;
const TIMEOUT_MS = 120_000;


export const passkeysAvailable = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;

const buf = (bytes: Uint8Array) => bytes as BufferSource;

// Makes this browser's passkey: ES256, user verification required. Null when the browser can't make one or hand over
// its public key (then the browser pairs to read, as before, and can't approve).
export async function createPasskey(user: { id: string; name: string }, hostname: string): Promise<BrowserPasskey | null> {
  if (!passkeysAvailable()) return null;
  const made = (await navigator.credentials.create({
    publicKey: {
      challenge: buf(crypto.getRandomValues(new Uint8Array(32))),
      // The rp id is the page's own host: sign.weft.zip (the only one the host takes), or a dev host it allows only unpackaged.
      rp: { id: hostname, name: "Weft" },
      user: { id: buf(new TextEncoder().encode(user.id).slice(0, 64)), name: user.name || "Weft", displayName: user.name || "Weft" },
      pubKeyCredParams: [{ type: "public-key", alg: COSE_ES256 }],
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      attestation: "none",
      timeout: TIMEOUT_MS,
    },
  })) as PublicKeyCredential | null;
  // Partial: getPublicKey is missing on older browsers.
  const response = made?.response as Partial<AuthenticatorAttestationResponse> | undefined;
  const spki = response?.getPublicKey?.();
  if (!made || !spki || response?.getPublicKeyAlgorithm?.() !== COSE_ES256) return null;
  return { credId: toB64url(new Uint8Array(made.rawId)), publicKey: toB64url(new Uint8Array(spki)) };
}

export interface PasskeySignature {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}

// Signs the approval message with this browser's passkey: Touch ID, then the assertion over SHA-256(message).
export async function signWithPasskey(credId: string, message: string, hostname: string): Promise<PasskeySignature> {
  if (!passkeysAvailable()) throw new Error("This browser can't use passkeys.");
  const got = (await navigator.credentials.get({
    publicKey: {
      challenge: buf(await sha256(message)),
      rpId: hostname,
      allowCredentials: [{ type: "public-key", id: buf(fromB64url(credId)) }],
      userVerification: "required",
      timeout: TIMEOUT_MS,
    },
  })) as PublicKeyCredential | null;
  const response = got?.response as AuthenticatorAssertionResponse | undefined;
  if (!response?.signature) throw new Error("The passkey didn't sign.");
  return {
    authenticatorData: toB64url(new Uint8Array(response.authenticatorData)),
    clientDataJSON: toB64url(new Uint8Array(response.clientDataJSON)),
    signature: toB64url(new Uint8Array(response.signature)),
  };
}
