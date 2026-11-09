// The GitHub repos this Mac keeps an unshared vault for, holding at least one value: what electron/device-beat.cjs
// reports on this Mac's devices row (local_vaults), so the team page can say "Secrets on m5air only" from anywhere
// (docs/architecture/teams-vault.md, "Sharing from the team page").
//
// It reads each vault file's id and whether an entry has ciphertext, nothing else: no value is decrypted and no key
// unwrapped, and only "owner/name" leaves this file.
const fs = require("node:fs");
const path = require("node:path");

const REPO = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/;

// A vault's own file is <16 hex>.json; its .shared.json and .sync.json beside it are metadata.
const VAULT_FILE = /^[0-9a-f]{16}\.json$/;

/**
 * @param {string} dir ~/.weft/vault
 * @returns {string[]} sorted owner/name repos
 */
function localVaultRepos(dir) {
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const repos = new Set();
  for (const file of files) {
    if (!VAULT_FILE.test(file) || files.includes(file.replace(/\.json$/, ".shared.json"))) continue;
    try {
      const vault = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      const repo = typeof vault.id === "string" && vault.id.startsWith("github:") ? vault.id.slice("github:".length) : "";
      const held = Array.isArray(vault.secrets) && vault.secrets.some((s) => typeof s?.ciphertext === "string");
      if (REPO.test(repo) && held) repos.add(repo);
    } catch {
      // A torn or foreign file says nothing about this Mac's vaults.
    }
  }
  return [...repos].sort();
}

module.exports = { localVaultRepos };
