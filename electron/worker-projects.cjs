// Which GitHub repo a Weft Worker's project is, as this Mac knows it (electron/worker-ask.cjs vaultFor): the worker names
// its project by folder, and a folder name is the worker's word, so main looks the name up among this Mac's own projects
// (~/.weft/settings.json: the projects list and the folders that run on a worker, lib/worker-handoff.ts sends their
// basename as the folder) and reads each one's git remote as a vault id (electron/vault-id.cjs).
const fs = require("node:fs");
const path = require("node:path");
const { vaultIdFor } = require("./vault-id.cjs");

// This Mac's projects and the folders that run on a worker, from ~/.weft/settings.json.
function folderList(dataDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));
    const projects = Array.isArray(s.projects) ? s.projects.map((p) => p?.path) : [];
    const workers = Array.isArray(s.workerFolders) ? s.workerFolders : [];
    return [...new Set([...workers, ...projects].filter((f) => typeof f === "string" && f))];
  } catch {
    return [];
  }
}

/**
 * @param {{ dataDir: string, idFor?: (folder: string) => Promise<{ id: string }> }} deps
 * @returns {(folder: string) => Promise<string[]>} the vault ids of this Mac's projects with that folder name
 */
function createProjectRepos({ dataDir, idFor = (folder) => vaultIdFor(folder) }) {
  const folders = () => folderList(dataDir);
  return async (folder) => {
    const name = String(folder).toLowerCase();
    const matches = folders().filter((f) => path.basename(f).toLowerCase() === name);
    const ids = await Promise.all(matches.map((f) => idFor(f).then((r) => r.id, () => "")));
    return ids.filter((id) => id.startsWith("github:"));
  };
}

/**
 * Every GitHub repo this Mac has a checkout of (its projects and worker folders), as lowercase owner/name, sorted: the
 * list a connector grant covers (electron/connector-grants.cjs), read when the grant is signed.
 * @param {{ dataDir: string, idFor?: (folder: string) => Promise<{ id: string }> }} deps
 * @returns {() => Promise<string[]>}
 */
function createKnownRepos({ dataDir, idFor = (folder) => vaultIdFor(folder) }) {
  return async () => {
    const ids = await Promise.all(folderList(dataDir).map((f) => idFor(f).then((r) => r.id, () => "")));
    return [...new Set(ids.filter((id) => id.startsWith("github:")).map((id) => id.slice(7)))].sort();
  };
}

module.exports = { createProjectRepos, createKnownRepos };
