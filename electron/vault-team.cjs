// What the team's server says about the repos in the 🔐 drawer (docs/architecture/teams-vault.md, "Joining
// a shared vault"): the vaults that already exist, this Mac's place in each, and the Macs waiting for an
// admin. Metadata only: no key, no ciphertext, no wrapped key.
const { fingerprint, normalizeFingerprint } = require("./device-fingerprint.cjs");

// This Mac's standing on each vault, by repo.
function joinsFrom({ vaults, grants, asked, publicKey }) {
  const mine = fingerprint(publicKey);
  const granted = new Set(grants.filter((g) => g.device?.public_key === publicKey).map((g) => g.vault_id));
  const pending = new Set(asked.filter((p) => normalizeFingerprint(p.target_fingerprint) === mine).map((p) => p.vault_id));
  const joins = new Map();
  for (const v of vaults) {
    const state = granted.has(v.id) ? "granted" : pending.has(v.id) ? "asked" : "none";
    joins.set(v.repo, { vaultId: v.id, orgId: v.org_id, repo: v.repo, state, fingerprint: mine });
  }
  return joins;
}

// The Macs waiting for an admin, by vault.
function requestsFrom(rows) {
  const requests = new Map();
  for (const r of rows) {
    const list = requests.get(r.vault_id) ?? [];
    list.push({ id: r.id, person: r.person, deviceName: r.device_name, fingerprint: r.fingerprint });
    requests.set(r.vault_id, list);
  }
  return requests;
}

/**
 * Anything failing answers nothing, so the drawer still opens offline, with a reason the drawer can show
 * for there being no "Ask to join": signed-out (this Mac isn't signed in to a Weft account), error (the
 * lookup failed: offline, an RLS error) or no-account (a shell with no account client, so nothing to say). No reason means the lookup ran, so a repo missing from joins has
 * no shared vault in any workspace the account sees. publicKey may be a function, so a signed-out Mac
 * never loads its device key.
 *
 * @param {{ accountClient?: any, publicKey?: string | (() => string) }} deps
 * @returns {Promise<{ joins: Map<string, import("../lib/vault-shared").VaultJoin>, requests: Map<string, import("../lib/vault-shared").VaultDeviceRequest[]>, reason?: "signed-out" | "error" | "no-account" }>}
 */
async function teamVaults({ accountClient, publicKey: keyOf }) {
  const none = (reason) => ({ joins: new Map(), requests: new Map(), ...(reason && { reason }) });
  const db = accountClient?.supabase;
  if (!db) return none("no-account");
  if (accountClient.signedIn?.() === false) return none("signed-out");
  try {
    const publicKey = typeof keyOf === "function" ? keyOf() : keyOf;
    if (!publicKey) return none("error");
    const [vaults, grants, asked, waiting] = await Promise.all([
      db.from("vaults").select("id, org_id, repo"),
      db.from("vault_grants").select("vault_id, device:devices(public_key)"),
      db.from("pending_device_grants").select("vault_id, target_fingerprint").eq("status", "accepted"),
      db.rpc("pending_vault_devices"),
    ]);
    if (vaults.error) return none("error");
    return { joins: joinsFrom({ vaults: vaults.data ?? [], grants: grants.data ?? [], asked: asked.data ?? [], publicKey }), requests: requestsFrom(waiting.data ?? []) };
  } catch {
    return none("error");
  }
}

/**
 * Why a vault's header has no "Ask to join", for the drawer's one line under it: only for a GitHub repo's
 * local vault this Mac isn't asked into. First, though, this Mac's own standing (electron/device-standing.cjs): a Mac
 * removed from the account, or one that couldn't register, can't share or join anything, shared vaults included. "none" (nothing shared for the repo) only when the vault holds no
 * values here, since the Mac that has them is the one to press Share…, and it needn't be told so.
 *
 * @param {{ id: string, shared?: unknown, join?: unknown, reason?: "signed-out" | "error" | "no-account", secrets: { missing?: boolean }[], device?: string }} v
 * @returns {import("../lib/vault-shared").VaultJoinHint | undefined}
 */
function joinHintFor({ id, shared, join, reason, secrets, device }) {
  if ((device === "revoked" || device === "unregistered") && (shared || id.startsWith("github:"))) return device;
  if (shared || join || !id.startsWith("github:") || reason === "no-account") return undefined;
  if (reason) return reason;
  return secrets.some((e) => !e.missing) ? undefined : "none";
}

module.exports = { joinHintFor, teamVaults };
