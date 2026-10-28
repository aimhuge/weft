// The shared vault's metadata for the 🔐 drawer (docs/architecture/teams-vault.md, "What the 🔐
// drawer shows"): whether a local vault is shared and with which workspace, and which workspaces
// the user could share it with.
//
// Everything here is metadata — an org's id, slug and name, the vault key's version, the server
// version the shadow is at, and when the recovery key was last shown. No key material, no
// ciphertext, no wrapped key: the files read here hold none of those either, and the queries run
// as the signed-in user, so RLS keeps them to the workspaces they belong to.
const fs = require("node:fs");
const path = require("node:path");
const { hashOf } = require("./vault-sync-files.cjs");

/** @typedef {{ orgId: string, vaultId: string, repo: string, keyVersion: number, recoveryShownAt?: string | null }} SharedFile */
/** @typedef {{ vaultId: string, orgId: string, serverVersion: number }} SyncFile */

/**
 * A JSON file beside the vault's own <hash>.json, read.
 * @param {string} file
 */
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * The shared block for a vault, or null when the vault is local-only.
 *
 * The <hash>.shared.json beside the vault's file says which workspace it belongs to; the
 * <hash>.sync.json says how far the local shadow has caught up with the server.
 *
 * @param {{ dir: string, id: string, orgs?: { id: string, slug: string, name: string }[] }} deps
 * @returns {import("../lib/vault-shared").VaultShared | null}
 */
function sharedBlock({ dir, id, orgs = [] }) {
  const base = path.join(dir, hashOf(id));
  /** @type {SharedFile | null} */
  const shared = readJson(`${base}.shared.json`);
  if (!shared?.orgId) return null;
  /** @type {SyncFile | null} */
  const sync = readJson(`${base}.sync.json`);
  const org = orgs.find((o) => o.id === shared.orgId);
  return {
    // The workspace's name and slug come from the orgs list; a workspace the user has since left
    // still shows, by its id alone.
    org: { id: shared.orgId, slug: org?.slug ?? "", name: org?.name ?? "" },
    // The server's id for this vault: what the team's pages and the recovery key's page address.
    vaultId: shared.vaultId ?? "",
    keyVersion: Number(shared.keyVersion ?? 1),
    serverVersion: Number(sync?.serverVersion ?? 0),
    recoveryShownAt: shared.recoveryShownAt ?? null,
  };
}

/**
 * The workspaces the signed-in user is in, with how many people are in each.
 *
 * `orgs` and `org_memberships` are both readable by the user themselves (the RLS policies let you
 * see the workspaces you belong to and their rosters), so this is the user's own view and needs no
 * service key. A signed-out desktop answers with an empty list rather than an error.
 *
 * @param {{ accountClient?: { supabase?: any, signedIn?: () => boolean } | null }} deps
 * @returns {Promise<import("../lib/vault-shared").VaultOrg[]>}
 */
async function listOrgs({ accountClient } = {}) {
  const db = accountClient?.supabase;
  if (!db || accountClient?.signedIn?.() === false) return [];
  try {
    const [orgsRes, membersRes] = await Promise.all([
      db.from("orgs").select("id, slug, name"),
      db.from("org_memberships").select("org_id"),
    ]);
    if (orgsRes.error || membersRes.error) return [];
    /** @type {{ id: string, slug: string, name: string }[]} */
    const orgs = orgsRes.data ?? [];
    // One membership row per person per workspace, so the rows for a workspace are its headcount.
    const counts = new Map();
    for (const row of membersRes.data ?? []) counts.set(row.org_id, (counts.get(row.org_id) ?? 0) + 1);
    return orgs.map((o) => ({ id: o.id, slug: o.slug, name: o.name, members: counts.get(o.id) ?? 0 }));
  } catch {
    // A signed-out desktop, an offline one, or a server that doesn't know teams yet: no offer.
    return [];
  }
}

module.exports = { sharedBlock, listOrgs };
