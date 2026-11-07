// A team-linked repo's vault is the team's (docs/architecture/teams-vault.md, "A linked repo shares its vault").
// Linking a repo in Settings → Teams → Projects is the share; these are main's background chores that make it so
// without a Share… or an Approve per vault:
//
//   linkedRepos   which of the drawer's repos a team has linked (public.team_orgs_for_repos), so the drawer can say
//     "Shared with <team>" and offer the share to any member, not only an admin.
//   autoAsk       a Mac on a linked repo the team already shares asks to join by itself, once per vault. A Mac the team
//     already trusts is then sealed the key by whoever holds it (sealTrusted in electron/vault-shared-api.cjs).
//   newRequests   the Macs waiting on an admin that this Mac hasn't told the admin about yet, for a notification.
//
// Metadata only: repo names, vault and request ids, a person's and a Mac's name. No key, no ciphertext.
const fs = require("node:fs");
const path = require("node:path");

/** @typedef {import("../lib/vault-shared").VaultJoin} VaultJoin */
/** @typedef {import("../lib/vault-shared").VaultDeviceRequest} VaultDeviceRequest */

/**
 * The team (org id) that linked each of these repos, for the ones a team the user is in has linked.
 * Anything failing answers nothing: the drawer still opens offline.
 *
 * @param {{ accountClient?: any, repos: string[] }} deps
 * @returns {Promise<Map<string, string>>} lower-case repo → org id
 */
async function linkedRepos({ accountClient, repos }) {
  const linked = new Map();
  const db = accountClient?.supabase;
  if (!db || !repos.length || accountClient?.signedIn?.() === false) return linked;
  try {
    const { data, error } = await db.rpc("team_orgs_for_repos", { repos });
    if (error) return linked;
    for (const row of data ?? []) if (row?.repo && row?.org_id) linked.set(String(row.repo).toLowerCase(), String(row.org_id));
  } catch {
    // Offline, or a server without the function: no links.
  }
  return linked;
}

// The vaults this Mac already asked to join by itself, kept so a declined request isn't sent again on every focus.
// After a decline, "Ask to join" in the drawer is still there to press by hand.
function askedStore(dir) {
  const file = path.join(dir, "team-asked.json");
  const read = () => {
    try {
      const list = JSON.parse(fs.readFileSync(file, "utf8"));
      return new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
      return new Set();
    }
  };
  return {
    has: (vaultId) => read().has(vaultId),
    add(vaultId) {
      const all = read();
      all.add(vaultId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify([...all]));
    },
  };
}

/**
 * Ask to join every vault the team shares for a linked repo this Mac has and isn't in yet, once each.
 *
 * @param {{ joins: Map<string, VaultJoin>, linked: Map<string, string>, asked: { has: (id: string) => boolean, add: (id: string) => void },
 *   requestJoin: (vaultId: string) => Promise<unknown> }} deps
 * @returns {Promise<string[]>} the vault ids asked for now
 */
async function autoAsk({ joins, linked, asked, requestJoin }) {
  const now = [];
  for (const join of joins.values()) {
    if (join.state !== "none" || linked.get(join.repo.toLowerCase()) !== join.orgId || asked.has(join.vaultId)) continue;
    try {
      await requestJoin(join.vaultId);
      now.push(join.vaultId);
    } catch {
      // A closed vault or a server hiccup: the drawer's "Ask to join" is still there.
    }
    asked.add(join.vaultId);
  }
  return now;
}

/**
 * The requests in `requests` this Mac hasn't notified about yet; `seen` is updated so each is told once a launch.
 *
 * @param {Map<string, VaultDeviceRequest[]>} requests
 * @param {Set<string>} seen
 * @returns {VaultDeviceRequest[]}
 */
function newRequests(requests, seen) {
  const fresh = [];
  for (const list of requests.values()) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      fresh.push(r);
    }
  }
  return fresh;
}

// The notification's words for the Macs waiting on an admin.
function requestNotice(fresh) {
  if (!fresh.length) return null;
  const first = fresh[0];
  const body = fresh.length === 1 ? `${first.person} asks to add ${first.deviceName}. Open 🔐 to approve it once for the team.` : `${fresh.length} Macs ask to join your team's vaults. Open 🔐 to approve them.`;
  return { title: "A teammate's Mac wants your team's secrets", body };
}

/**
 * Mark each GitHub vault a team linked with that team (`linked` on the drawer's vault), and answer the links.
 *
 * @param {{ accountClient?: any, vaults: { id: string, linked?: { orgId: string, name: string } }[], orgs: { id: string, name: string }[] }} deps
 */
async function linkedOf({ accountClient, vaults, orgs }) {
  const repos = vaults.map((v) => v.id).filter((id) => id.startsWith("github:")).map((id) => id.slice("github:".length));
  const linked = await linkedRepos({ accountClient, repos });
  for (const v of vaults) {
    const orgId = linked.get(v.id.replace(/^github:/, ""));
    const org = orgId && orgs.find((o) => o.id === orgId);
    if (org) v.linked = { orgId, name: org.name };
  }
  return linked;
}

/**
 * The chores after each overview, one run at a time and in the background, so the drawer never waits on them: ask
 * to join linked vaults, seal the vaults this Mac holds to Macs the team approved once, and notify an admin of Macs
 * still waiting. When something changed, the board loads the vaults again (onChange), which runs this once more and
 * finds nothing left to do.
 *
 * @param {{ dir: string, accountClient?: any, sharedApi: () => Promise<any>, notifyUser: (n: { title: string, body: string }) => void,
 *   onChange: (folder: string) => void }} deps
 */
function createTeamUpkeep({ dir, accountClient, sharedApi, notifyUser, onChange }) {
  const asked = askedStore(dir);
  const told = new Set();
  let running = null;
  async function once(team, linked, folder) {
    const api = await sharedApi();
    const now = await autoAsk({ joins: team.joins, linked, asked, requestJoin: (vaultId) => api.requestJoin({ vaultId, accountClient }) });
    const { sealed } = await api.sealTrusted({ accountClient });
    // A sealed Mac's request is gone on the next load; telling the admin about it now would be a false alarm.
    const notice = sealed ? null : requestNotice(newRequests(team.requests, told));
    if (notice) notifyUser(notice);
    if ((now.length || sealed) && folder) onChange(folder);
  }
  return {
    /** @param {{ joins: Map<string, VaultJoin>, requests: Map<string, VaultDeviceRequest[]> }} team */
    run(team, linked, folder) {
      if (!accountClient || running) return running;
      running = once(team, linked, folder)
        .catch(() => null)
        .finally(() => {
          running = null;
        });
      return running;
    },
  };
}

module.exports = { linkedRepos, linkedOf, askedStore, autoAsk, newRequests, requestNotice, createTeamUpkeep };
