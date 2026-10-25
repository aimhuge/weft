// Which vault a project folder opens (electron/vault.cjs): its git remote as an id, so a teammate's clone of the
// same repo finds the same vault, else the folder itself.
const { execFile } = require("node:child_process");
const path = require("node:path");

function git(folder, args) {
  return new Promise((resolve) => {
    execFile("git", ["-C", folder, ...args], { timeout: 5000 }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

// A remote URL as a vault id: GitHub repos as github:owner/name, so a teammate's clone finds the same vault.
function parseRemote(url) {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/i.exec(url.trim());
  if (!m) return null;
  const [, host, repo] = m;
  const label = repo.replace(/^\/+/, "");
  return { id: host.toLowerCase() === "github.com" ? `github:${label.toLowerCase()}` : `${host.toLowerCase()}:${label}`, label };
}

/** @returns {Promise<{ id: string, label: string }>} */
async function vaultIdFor(folder, run = git) {
  const remote = await run(folder, ["remote", "get-url", "origin"]);
  return (remote && parseRemote(remote)) || { id: `folder:${path.resolve(folder)}`, label: path.basename(folder) };
}

module.exports = { git, parseRemote, vaultIdFor };
