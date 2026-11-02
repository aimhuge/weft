// Which GitHub repo a Weft Worker's project is, as this Mac knows it (electron/worker-ask.cjs vaultFor): the worker names
// its project by folder, and a folder name is the worker's word, so main looks the name up among this Mac's own projects
// (~/.weft/settings.json: the projects list and the folders that run on a worker, lib/worker-handoff.ts sends their
// basename as the folder) and reads each one's git remote as a vault id (electron/vault-id.cjs).
const fs = require("node:fs");
const path = require("node:path");
const { vaultIdFor } = require("./vault-id.cjs");

/**
 * This Mac's projects with a worker folder's name, each with its vault id: a worker card's vault call
 * (electron/worker-vault.cjs) acts on the one whose id its remote names, through this Mac's own clone.
 * @param {{ dataDir: string, idFor?: (folder: string) => Promise<{ id: string }> }} deps
 * @returns {(folder: string) => Promise<{ path: string, id: string }[]>}
 */
function createProjectFolders({ dataDir, idFor = (folder) => vaultIdFor(folder) }) {
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
    const found = await Promise.all(matches.map((f) => idFor(f).then((r) => ({ path: f, id: r.id }), () => ({ path: f, id: "" }))));
    return found.filter((m) => m.id.startsWith("github:"));
  };
}

/** @param {Parameters<typeof createProjectFolders>[0]} deps @returns {(folder: string) => Promise<string[]>} the vault ids alone */
function createProjectRepos(deps) {
  const folders = createProjectFolders(deps);
  return async (folder) => (await folders(folder)).map((m) => m.id);
}

/**
 * Which project each worker card belongs to, pinned by main the first time the card reaches the vault
 * (electron/worker-vault.cjs). A card's folder on cloud_cards is the worker's word, rewritable with its `wwk_` key, so a
 * card whose folder later changes is refused rather than followed to another project's vault. Kept in ~/.weft/vault,
 * which threads can't read or edit.
 * @param {{ dataDir: string }} deps
 * @returns {(workerId: string, cardId: string, folder: string) => void} throws when the card's folder changed
 */
function createCardFolderPins({ dataDir }) {
  const file = path.join(dataDir, "vault", "worker-card-folders.json");
  return (workerId, cardId, folder) => {
    let pins = {};
    try {
      pins = JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
    } catch {
      pins = {};
    }
    const key = `${workerId}\n${cardId}`;
    const was = pins[key];
    if (typeof was === "string" && was !== folder) throw new Error(`That card was in ${was} when it first reached the vault, and says ${folder} now, so this Mac won't answer it. Start a new card in ${folder}.`);
    if (was === folder) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify({ ...pins, [key]: folder }), { mode: 0o600 });
  };
}

module.exports = { createProjectRepos, createProjectFolders, createCardFolderPins };
