// Enrolling a Weft Worker by pairing it, the box's half (docs/architecture/device-registry.md): the code the install
// line carries, the claim the box makes, and the short check code both sides show. The same steps as pairing a phone
// (lib/pairing-link.ts): a secret only the person at the Mac has seen, an HMAC proof with it, a signature with the key
// the claim names, then the Mac checks both and asks Touch ID. Main's copy of the check is electron/host-pairing.cjs;
// lib/host-pairing.test.ts proves the two agree. Node's crypto only: the box runs no libsodium for this.
import crypto from "node:crypto";

// `wph.<pairing id>.<org id>.<secret>`: shell-safe, so it rides `sh -s -- <code>` like an enrolment token.
export const PAIR_CODE_PREFIX = "wph.";
// A raw 32-byte Ed25519 key, base64url without padding.
const MAC_KEY = /^[A-Za-z0-9_-]{43}$/;

export interface HostPairCode {
  id: string;
  orgId: string;
  // 32 random bytes, base64url.
  secret: string;
  // The pairing Mac's Ed25519 approval key (electron/desktop-signer.cjs), base64: the code is carried to the box by hand,
  // so this is the one Mac key the box can trust for its secret_use rows (lib/worker-mac-keys.ts). Absent from older codes.
  macKey?: string;
}

export interface HostClaimBody {
  name: string;
  platform: string;
  arch: string;
  // The worker's X25519 seal key (DER SPKI, base64): what a Claude or GitHub token is sealed to.
  box_key: string;
  // The worker's Ed25519 key (DER SPKI, base64).
  sign_key: string;
  // sha256 hex of the worker's own `wwk_` key, which never leaves the box.
  key_hash: string;
}

export interface HostClaim extends HostClaimBody {
  proof: string;
  sig: string;
}

export interface SignKeys {
  publicKey: string;
  privateKey: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
export const HOST_PLATFORMS: readonly string[] = ["darwin", "linux", "win32"];
// A name or arch is one line of the signed message, so it can't hold a line break or any other control character.
export const PLAIN_LINE = /^[^\p{Cc}]+$/u;
// A name also shows in the Mac's Touch ID prompt, so it keeps to letters, digits, spaces and . _ ( ) -: no quotes,
// no control or format characters, nothing that could make the prompt read as something else.
export const SAFE_NAME = /^[\p{L}\p{N} ._()-]{1,80}$/u;

// A host name as a claim's name: the characters SAFE_NAME refuses dropped, 80 at most, "worker" when nothing is left.
export function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N} ._()-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 80) || "worker";
}

export const isPairCode = (code: string) => code.trim().startsWith(PAIR_CODE_PREFIX);

export function pairCode(c: HostPairCode): string {
  const mac = c.macKey ? `.${Buffer.from(c.macKey, "base64").toString("base64url")}` : "";
  return `${PAIR_CODE_PREFIX}${c.id}.${c.orgId}.${c.secret}${mac}`;
}

export function parsePairCode(code: string): HostPairCode | null {
  const trimmed = code.trim();
  if (!isPairCode(trimmed)) return null;
  const [id = "", orgId = "", secret = "", mac, ...rest] = trimmed.slice(PAIR_CODE_PREFIX.length).split(".");
  if (rest.length || !UUID.test(id) || !UUID.test(orgId) || !SECRET.test(secret)) return null;
  if (mac === undefined) return { id, orgId, secret };
  return MAC_KEY.test(mac) ? { id, orgId, secret, macKey: Buffer.from(mac, "base64url").toString("base64") } : null;
}

export const newPairSecret = () => crypto.randomBytes(32).toString("base64url");

export const hostClaimMessage = (pairingId: string, orgId: string, c: HostClaimBody) =>
  ["weft-host-pair-v1", pairingId, orgId, c.box_key, c.sign_key, c.key_hash, c.name, c.platform, c.arch].join("\n");

// HMAC-SHA-512-256, the same bytes as libsodium's crypto_auth, so a phone's proof and a worker's are one kind.
export const proofOf = (secret: string, message: string) =>
  crypto.createHmac("sha512", Buffer.from(secret, "base64url")).update(message).digest().subarray(0, 32).toString("base64");

// The code both the box and the Mac's Touch ID prompt show: four bytes of the claim's hash. If someone else claimed
// the code first, the Mac shows a different one.
export function checkCode(pairingId: string, orgId: string, c: HostClaimBody): string {
  const hex = crypto.createHash("sha256").update(hostClaimMessage(pairingId, orgId, c)).digest("hex").slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

export function newSignKeys(): SignKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

// A worker key in the same shape worker_enrol hands out, made on the box instead.
export const newWorkerKey = () => `wwk_${crypto.randomBytes(32).toString("hex")}`;
export const keyHash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

export function makeHostClaim(code: HostPairCode, body: HostClaimBody, sign: SignKeys): HostClaim {
  if (!SAFE_NAME.test(body.name)) throw new Error("The worker's name must be up to 80 letters, digits, spaces or . _ ( ) -.");
  if ((body.arch !== "" && !PLAIN_LINE.test(body.arch)) || body.arch.length > 20) throw new Error("The worker's arch must be one short line.");
  const message = hostClaimMessage(code.id, code.orgId, body);
  const key = crypto.createPrivateKey({ key: Buffer.from(sign.privateKey, "base64"), format: "der", type: "pkcs8" });
  return { ...body, proof: proofOf(code.secret, message), sig: crypto.sign(null, Buffer.from(message), key).toString("base64") };
}
