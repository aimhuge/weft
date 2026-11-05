// A passkey made by hand for tests: a real P-256 key, and assertions built the way an authenticator builds them
// (authenticatorData, clientDataJSON, a DER signature over authData ‖ SHA-256(clientData)).
import { passkeyChallenge, sha256, toB64url, PASSKEY_ORIGIN, PASSKEY_RP_ID, type PasskeyAssertion } from "./passkey-verify";

function intDer(bytes: Uint8Array): number[] {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const body = [...bytes.subarray(i)];
  if ((body[0] as number) & 0x80) body.unshift(0);
  return [0x02, body.length, ...body];
}

export const rawToDer = (raw: Uint8Array) => {
  const body = [...intDer(raw.subarray(0, 32)), ...intDer(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
};

export async function authData({ rpId = PASSKEY_RP_ID, flags = 0x05, counter = 0 } = {}) {
  const out = new Uint8Array(37);
  out.set(await sha256(rpId), 0);
  out[32] = flags;
  new DataView(out.buffer).setUint32(33, counter);
  return out;
}

export interface Build {
  client?: Record<string, unknown> | string;
  auth?: Uint8Array;
  key?: CryptoKey;
  der?: (der: Uint8Array) => Uint8Array;
}

export interface TestPasskey {
  keys: CryptoKeyPair;
  // SPKI, base64url: what the host pins.
  publicKey: string;
  sign: (message: string, build?: Build) => Promise<PasskeyAssertion>;
}

export async function makePasskey(): Promise<TestPasskey> {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = toB64url(new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey)));
  async function sign(message: string, { client, auth, key, der = (d) => d }: Build = {}): Promise<PasskeyAssertion> {
    const clientData = typeof client === "string" ? client : JSON.stringify({ type: "webauthn.get", challenge: await passkeyChallenge(message), origin: PASSKEY_ORIGIN, crossOrigin: false, ...client });
    const clientBytes = new TextEncoder().encode(clientData);
    const authBytes = auth ?? (await authData());
    const signed = new Uint8Array([...authBytes, ...(await sha256(clientBytes))]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key ?? keys.privateKey, signed));
    return { authenticatorData: toB64url(authBytes), clientDataJSON: toB64url(clientBytes), signature: toB64url(der(rawToDer(raw))) };
  }
  return { keys, publicKey, sign };
}
