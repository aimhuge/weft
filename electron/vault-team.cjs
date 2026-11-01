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
 * Anything failing answers nothing, so the drawer still opens offline.
 *
 * @param {{ accountClient?: any, publicKey?: string }} deps
 * @returns {Promise<{ joins: Map<string, import("../lib/vault-shared").VaultJoin>, requests: Map<string, import("../lib/vault-shared").VaultDeviceRequest[]> }>}
 */
async function teamVaults({ accountClient, publicKey }) {
  const none = { joins: new Map(), requests: new Map() };
  const db = accountClient?.supabase;
  if (!db || !publicKey || accountClient?.signedIn?.() === false) return none;
  try {
    const [vaults, grants, asked, waiting] = await Promise.all([
      db.from("vaults").select("id, org_id, repo"),
      db.from("vault_grants").select("vault_id, device:devices(public_key)"),
      db.from("pending_device_grants").select("vault_id, target_fingerprint").eq("status", "accepted"),
      db.rpc("pending_vault_devices"),
    ]);
    if (vaults.error) return none;
    return { joins: joinsFrom({ vaults: vaults.data ?? [], grants: grants.data ?? [], asked: asked.data ?? [], publicKey }), requests: requestsFrom(waiting.data ?? []) };
  } catch {
    return none;
  }
}

module.exports = { teamVaults };
