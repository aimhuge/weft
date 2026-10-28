// The project's .env files as the vault reads them (docs/architecture/secrets.md): parsed, compared with the
// vault, and the rail's nudge. Out of electron/vault.cjs; values stay in main.
const fs = require("node:fs");
const path = require("node:path");
const { findEnvFiles, envFileKind, isVercelPull, parseEnv, shortLived } = require("./dotenv.cjs");
const { isManaged, readOrNull } = require("./env-writeback.cjs");

// Files whose values the rail nudges you to import.
const NUDGE_FILES = new Set([".env.local", ".env.development.local"]);

// The project's .env files, parsed. Only files findEnvFiles lists, so a request can't name another path.
function readFiles(folder) {
  return findEnvFiles(folder).map((file) => {
    const text = fs.readFileSync(path.join(folder, file), "utf8");
    return { file, kind: envFileKind(file), vercel: isVercelPull(text), entries: parseEnv(text) };
  });
}

function status(have, value) {
  if (have === undefined) return "new";
  return have === value ? "same" : "differs";
}

// Values in the nudge files that the vault doesn't hold yet, or holds differently. s is null with no vault yet.
function nudge(folder, id, s) {
  const pending = new Set();
  let file;
  for (const f of readFiles(folder)) {
    if (!NUDGE_FILES.has(path.basename(f.file))) continue;
    for (const e of f.entries) {
      if ((f.vercel && shortLived(e.name)) || pending.has(e.name)) continue;
      if (s?.exists(id) && s.get(id, e.name, f.kind.environment) === e.value) continue;
      pending.add(e.name);
      file ??= f.file;
    }
  }
  return pending.size ? { count: pending.size, file, managed: isManaged(readOrNull(path.join(folder, file))) } : null;
}

module.exports = { readFiles, status, nudge };
