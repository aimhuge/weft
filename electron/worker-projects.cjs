// Which GitHub repo a Weft Worker's project is, as this Mac knows it (electron/worker-ask.cjs vaultFor): the worker names
// its project by folder, and a folder name is the worker's word, so main looks the name up among this Mac's own projects
// (~/.weft/settings.json: the projects list and the folders that run on a worker, lib/worker-handoff.ts sends their
// basename as the folder) and reads each one's git remote as a vault id (electron/vault-id.cjs).
const fs = require("node:fs");
const path = require("node:path");
const { vaultIdFor } = require("./vault-id.cjs");

/**
 * @param {{ dataDir: string, idFor?: (folder: string) => Promise<{ id: string }> }} deps
 * @returns {(folder: string) => Promise<string[]>} the vault ids of this Mac's projects with that folder name
 */
function createProjectRepos({ dataDir, idFor = (folder) => vaultIdFor(folder) }) {
  function folders() {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));
      const projects = Array.isArray(s.projects) ? s.projects.map((p) => p?.path) : [];
      const workers = Array.isArray(s.workerFolders) ? s.workerFolders : [];
      return [...new Set([...workers, ...projects].filter((f) => typeof f === "string" && f))];
    } catch {
      return [];
    }
  }
  return async (folder) => {
    const name = String(folder).toLowerCase();
    const matches = folders().filter((f) => path.basename(f).toLowerCase() === name);
    const ids = await Promise.all(matches.map((f) => idFor(f).then((r) => r.id, () => "")));
    return ids.filter((id) => id.startsWith("github:"));
  };
}

module.exports = { createProjectRepos };
