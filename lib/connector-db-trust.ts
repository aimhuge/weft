// The signed side of weft.zip's connector rows (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust):
// the Mac keys that may say yes (connector_signers), the workers they vouched for (connector_worker_pins), the nonces of
// signed statements taken, and the signed grant and Allow writes. Only weft.zip writes any of it, after checking the
// signature (lib/connector-signed.ts, lib/connector-signers.ts); your session only reads. Server-only: service role.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SignerRow {
  id: string;
  user_id: string;
  sign_key: string;
  name: string;
  device: string | null;
  added_at: string;
  trusted_from: string | null;
  endorsed_by: string | null;
  revoked_at: string | null;
  confirm_hash?: string | null;
  confirm_expires_at?: string | null;
  confirm_sent_at?: string | null;
  confirm_sends?: number;
  revoke_hashes?: string[];
}

// A new key, or a pending one's link sent again.
export interface SignerConfirm {
  confirm_hash: string | null;
  confirm_expires_at: string | null;
  confirm_sent_at: string | null;
  confirm_sends?: number;
  revoke_hashes?: string[];
}

export interface WorkerPin {
  worker_id: string;
  user_id: string;
  sign_key: string;
  box_key: string;
  signer_id: string;
  sig: string;
}

export interface GrantWrite {
  user_id: string;
  worker_id: string;
  connector: string;
  scope: string;
  approval: string;
  lifetime: string;
  asks: string[];
  repos: string[];
  signer_id: string;
  sig: string;
  nonce: string;
  issued_at: string;
  epoch: number;
}

export interface AllowWrite {
  grant_id: string;
  user_id: string;
  kind: string;
  subject: string;
  signer_id: string;
  sig: string;
  nonce: string;
  issued_at: string;
}

export interface TrustDb {
  signerById(id: string): Promise<SignerRow | null>;
  signerByKey(userId: string, key: string): Promise<SignerRow | null>;
  signers(userId: string): Promise<SignerRow[]>;
  // Adds a key, or puts a revoked one back as new (waiting again); the row as stored.
  saveSigner(row: Omit<SignerRow, "id" | "added_at" | "endorsed_by" | "revoked_at"> & { endorsed_by?: string | null; added_ip?: string; added_ua?: string }): Promise<SignerRow>;
  setConfirm(id: string, c: SignerConfirm): Promise<void>;
  // Trusts a key from `at`, vouched for by `by` (or by the emailed link, null), and spends its confirm link.
  trustSigner(id: string, at: string, by: string | null): Promise<void>;
  dropPinsBySigner(signerId: string): Promise<void>;
  revokeSigner(id: string, at: string): Promise<void>;
  workerPin(workerId: string): Promise<WorkerPin | null>;
  savePin(pin: WorkerPin): Promise<void>;
  // Takes a signed statement's nonce for the user; false when it was taken already (a replay).
  takeNonce(userId: string, nonce: string): Promise<boolean>;
  dropNoncesBefore(at: string): Promise<void>;
  // Writes a grant at the epoch given; false when the grant's epoch moved since the signature named it.
  writeGrant(row: GrantWrite, prevEpoch: number): Promise<boolean>;
  saveAllow(row: AllowWrite): Promise<void>;
  userEmail(userId: string): Promise<string | null>;
}

type R = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

// The part of supabase-js's query builder these files use, so each call stays typed without the generated schema.
export interface Q extends PromiseLike<R> {
  select(columns: string, options?: object): Q;
  insert(row: object): Q;
  update(row: object): Q;
  upsert(row: object, options?: object): Q;
  delete(): Q;
  eq(column: string, value: unknown): Q;
  lt(column: string, value: unknown): Q;
  not(column: string, op: string, value: unknown): Q;
  in(column: string, values: unknown[]): Q;
  or(filter: string): Q;
  limit(n: number): Q;
  order(column: string, options?: object): Q;
  maybeSingle(): PromiseLike<R>;
  single(): PromiseLike<R>;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the row type its select returns
export function must<T>(r: R, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

const SIGNER = "id, user_id, sign_key, name, device, added_at, trusted_from, endorsed_by, revoked_at, confirm_hash, confirm_expires_at, confirm_sent_at, confirm_sends, revoke_hashes";
const PIN = "worker_id, user_id, sign_key, box_key, signer_id, sig";

export function supabaseTrustDb(db: SupabaseClient): TrustDb {
  const t = (name: string) => db.from(name) as unknown as Q;
  return {
    async signerById(id) {
      return must<SignerRow | null>(await t("connector_signers").select(SIGNER).eq("id", id).maybeSingle(), "Reading the Mac key");
    },
    async signerByKey(userId, key) {
      return must<SignerRow | null>(await t("connector_signers").select(SIGNER).eq("user_id", userId).eq("sign_key", key).maybeSingle(), "Reading the Mac key");
    },
    async signers(userId) {
      return must<SignerRow[] | null>(await t("connector_signers").select(SIGNER).eq("user_id", userId), "Reading your Mac keys") ?? [];
    },
    async saveSigner(row) {
      const stored = { endorsed_by: null, ...row, revoked_at: null, added_at: new Date().toISOString() };
      return must<SignerRow>(await t("connector_signers").upsert(stored, { onConflict: "user_id,sign_key" }).select(SIGNER).single(), "Saving the Mac key");
    },
    async setConfirm(id, c) {
      must(await t("connector_signers").update(c).eq("id", id), "Saving the confirm link");
    },
    async trustSigner(id, at, by) {
      must(await t("connector_signers").update({ trusted_from: at, endorsed_by: by, confirm_hash: null, confirm_expires_at: null }).eq("id", id), "Trusting the Mac key");
    },
    async dropPinsBySigner(signerId) {
      must(await t("connector_worker_pins").delete().eq("signer_id", signerId), "Dropping the worker pins");
    },
    async revokeSigner(id, at) {
      must(await t("connector_signers").update({ revoked_at: at }).eq("id", id), "Revoking the Mac key");
    },
    async workerPin(workerId) {
      return must<WorkerPin | null>(await t("connector_worker_pins").select(PIN).eq("worker_id", workerId).maybeSingle(), "Reading the worker's pin");
    },
    async savePin(pin) {
      must(await t("connector_worker_pins").upsert({ ...pin, pinned_at: new Date().toISOString() }, { onConflict: "worker_id" }), "Saving the worker's pin");
    },
    async takeNonce(userId, nonce) {
      const r = await t("connector_signed_nonces").insert({ user_id: userId, nonce });
      if (r.error?.code === "23505") return false;
      must(r, "Taking the nonce");
      return true;
    },
    async dropNoncesBefore(at) {
      must(await t("connector_signed_nonces").delete().lt("at", at), "Dropping old nonces");
    },
    async writeGrant(row, prevEpoch) {
      if (prevEpoch === 0) {
        const r = await t("connector_grants").insert(row);
        if (r.error?.code === "23505") return false;
        must(r, "Saving the grant");
        return true;
      }
      const q = t("connector_grants").update(row).eq("user_id", row.user_id).eq("worker_id", row.worker_id).eq("connector", row.connector).eq("epoch", prevEpoch).select("id");
      return (must<unknown[] | null>(await q, "Saving the grant") ?? []).length > 0;
    },
    async saveAllow(row) {
      must(await t("connector_allows").upsert(row, { onConflict: "grant_id,kind,subject" }), "Saving the Allow");
    },
    async userEmail(userId) {
      const r = await db.auth.admin.getUserById(userId);
      return r.data.user?.email ?? null;
    },
  };
}
