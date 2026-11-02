// Mac keys and signed rows for the connector tests (lib/connector-*.test.ts): a Mac's Ed25519 approval key in
// libsodium's raw base64 (as electron/desktop-signer.cjs makes it), registered as a signer, and the grants, Allows and
// worker pins it signs, exactly as weft.zip's routes would store them (lib/connector-signed.ts).
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { settingsOf, type GrantSettings } from "./connector-grant";
import { allowMessage, grantMessage, startMessage, workerMessage } from "./connector-messages";
import type { GrantRow, WorkerRow } from "./connector-db";
import type { SignerRow } from "./connector-db-trust";
import { iso, NOW, type FakeState } from "./connector.harness";

export const DAY = 24 * 3_600_000;

export interface Mac {
  key: string;
  sign: (message: string) => string;
  signer: SignerRow;
}

// A fresh key pair: the raw public key in standard base64, and a signer for messages.
export function macKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = Buffer.from(String(publicKey.export({ format: "jwk" }).x), "base64url").toString("base64");
  return { key, sign: (message: string) => sign(null, Buffer.from(message), privateKey).toString("base64") };
}

let next = 1;

// A Mac key registered for `userId`, trusted from `trustedFrom` (a day ago by default, so trusted now).
export function trustedMac(state: FakeState, userId = "u1", o: { trustedFrom?: number | null; name?: string; revokedAt?: string } = {}): Mac {
  const k = macKey();
  const signer: SignerRow = { id: `mac-${next++}`, user_id: userId, sign_key: k.key, name: o.name ?? "MacBook", device: null, added_at: iso(NOW - 2 * DAY), trusted_from: o.trustedFrom === null ? null : iso(o.trustedFrom ?? NOW - DAY), endorsed_by: null, revoked_at: o.revokedAt ?? null };
  state.signers.push(signer);
  return { ...k, signer };
}

// The Mac vouches for the worker's pairing keys.
export function vouch(state: FakeState, mac: Mac, worker: WorkerRow, o: { signKey?: string; boxKey?: string } = {}) {
  const signKey = o.signKey ?? worker.sign_key ?? "";
  const boxKey = o.boxKey ?? "box";
  const sig = mac.sign(workerMessage({ userId: worker.owner_user, workerId: worker.id, signKey, boxKey }));
  state.pins.push({ worker_id: worker.id, user_id: worker.owner_user, sign_key: signKey, box_key: boxKey, signer_id: mac.signer.id, sig });
}

// A grant the Mac signed, stored as weft.zip's grant route stores it.
export function signedGrant(state: FakeState, mac: Mac, o: Partial<GrantSettings> & { id?: string; user_id?: string; worker_id?: string; epoch?: number; expires_at?: string | null; issuedAt?: number; repos?: string[] } = {}): GrantRow {
  const settings = settingsOf({ scope: "installed", ...o });
  const epoch = o.epoch ?? 1;
  const issuedAt = o.issuedAt ?? NOW - 60_000;
  const nonce = randomBytes(16).toString("hex");
  const user = o.user_id ?? mac.signer.user_id;
  const worker = o.worker_id ?? "w1";
  const repos = o.repos ?? ["o/r"];
  const sig = mac.sign(grantMessage({ userId: user, workerId: worker, connector: "github", settings, repos, nonce, issuedAt, prevEpoch: epoch - 1 }));
  const grant: GrantRow = { id: o.id ?? "g1", user_id: user, worker_id: worker, connector: "github", ...settings, repos, signer_id: mac.signer.id, sig, nonce, issued_at: iso(issuedAt), epoch, expires_at: o.expires_at ?? null, last_used_at: null };
  state.grants.push(grant);
  return grant;
}

// An Allow the Mac signed for a grant.
export function signedAllow(state: FakeState, mac: Mac, grant: GrantRow, kind: "project" | "card", subject: string) {
  const nonce = randomBytes(16).toString("hex");
  const issuedAt = NOW - 30_000;
  const sig = mac.sign(allowMessage({ userId: grant.user_id, grantId: grant.id, kind, subject, nonce, issuedAt }));
  state.allows.push({ grant_id: grant.id, user_id: grant.user_id, kind, subject, signer_id: mac.signer.id, sig, nonce, issued_at: iso(issuedAt) });
}

// The desktop board's card.create for a card, with the repo and the start the Mac signed (lib/worker-folder-repo.ts).
export function signedStartPayload(mac: Mac, o: { userId?: string; workerId?: string; cardId?: string; folder?: string; repo?: string; issuedAt?: number; nonce?: string } = {}) {
  const st = { userId: o.userId ?? mac.signer.user_id, workerId: o.workerId ?? "w1", cardId: o.cardId ?? "card-1", folder: o.folder ?? "r", repo: o.repo ?? "o/r", nonce: o.nonce ?? randomBytes(16).toString("hex"), issuedAt: o.issuedAt ?? NOW - 5_000 };
  return { verb: "card.create", args: { id: st.cardId }, repo: st.repo, start: { key: mac.key, sig: mac.sign(startMessage(st)), issuedAt: st.issuedAt, nonce: st.nonce } };
}

// The card.create row the board sends, made a moment after it was signed.
export function signedStart(state: FakeState, mac: Mac, o: Parameters<typeof signedStartPayload>[1] & { createdAt?: number } = {}) {
  const payload = signedStartPayload(mac, o);
  state.starts.push({ worker_id: o.workerId ?? "w1", card_id: o.cardId ?? "card-1", kind: "host", folder: o.folder ?? "r", payload, created_by: o.userId ?? mac.signer.user_id, created_at: iso(o.createdAt ?? payload.start.issuedAt + 1_000) });
  return payload;
}
