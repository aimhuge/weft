// One vault's row in the 🔐 drawer's overview (electron/vault.cjs `overview`): its secrets' names, the rail's nudge,
// and what the team's server says about it. Metadata only: names, ids, versions, a fingerprint. No value, no key.
const { sharedBlock } = require("./vault-shared-meta.cjs");

/**
 * @param {{ id: string, label: string, folder: string, store: any, dir: string, orgs: { id: string, slug: string, name: string }[],
 *   team: { joins: Map<string, any>, requests: Map<string, any[]> } | null, nudge: unknown, managed: boolean }} deps
 * @returns {import("../lib/vault-view").VaultSummary & { queued?: number }}
 */
function vaultRow({ id, label, folder, store: s, dir, orgs, team, nudge, managed }) {
  const secrets = s?.exists(id) ? s.list(id) : [];
  // shared: the vault is shared with a workspace (the drawer's badge and the Share offer).
  const shared = sharedBlock({ dir, id, orgs });
  // queued: writes to a shared vault made offline, waiting in <hash>.queue.jsonl (the drawer's chip).
  // join: the workspace already shares this repo and this Mac isn't in it. requests: Macs waiting to be.
  const join = !shared && team?.joins.get(id.replace(/^github:/, ""));
  const requests = shared && team?.requests.get(shared.vaultId);
  return { id, label, folder, folders: [folder], secrets, nudge, managed, ...(shared && { shared }), ...(join && { join }), ...(requests && { requests }), ...(s?.isShared(id) && { queued: s.queued(id) }) };
}

// A native notification (a teammate's Mac waiting for an admin); clicking it brings Weft to the front.
function showNotice(Notification, { title, body }, window) {
  if (!Notification?.isSupported?.()) return;
  const n = new Notification({ title, body });
  n.on("click", () => window?.()?.show?.());
  n.show();
}

module.exports = { vaultRow, showNotice };
