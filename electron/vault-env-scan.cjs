// The project's .env files as the vault reads them (docs/architecture/secrets.md): parsed, compared with the
// vault, and the rail's nudge. Out of electron/vault.cjs; values stay in main.
const path = require("node:path");
const { shortLived } = require("./dotenv.cjs");
const { freeFrom, readEnvFiles, valuedIn } = require("./env-sources.cjs");
const { tailOf } = require("./vault-store.cjs");
const { isManaged, readOrNull } = require("./env-writeback.cjs");

// Files whose values the rail nudges you to import.
const NUDGE_FILES = new Set([".env.local", ".env.development.local"]);

// The project's .env files, then the ones found or located elsewhere (electron/env-sources.cjs), parsed. Only files
// main found itself, so a request can't name another path. opts.skip holds folders never looked in (Weft's own
// worktree pool).
/** @param {string} folder @param {string[]} [located] @param {{ skip?: string[] }} [opts] */
function readFiles(folder, located = [], opts = {}) {
  return readEnvFiles(folder, located, opts);
}

function status(have, value) {
  if (have === undefined) return "new";
  return have === value ? "same" : "differs";
}

// Whether the nudge counts a file's value: one the vault doesn't hold yet, or holds differently; from a file
// elsewhere, only one it doesn't hold at all (a stale copy shouldn't nag).
function nudges(f, e, have) {
  if (f.vercel && shortLived(e.name)) return false;
  return have !== e.value && !(f.elsewhere && have !== undefined);
}

// Values in the nudge files (and the files elsewhere) the vault doesn't hold. s is null with no vault yet.
function nudge(folder, id, s, files = readFiles(folder)) {
  const pending = new Set();
  let file;
  for (const f of files) {
    if (!f.elsewhere && !NUDGE_FILES.has(path.basename(f.file))) continue;
    for (const e of f.entries) {
      const have = s?.exists(id) ? s.get(id, e.name, f.kind.environment) : undefined;
      if (pending.has(e.name) || !nudges(f, e, have)) continue;
      pending.add(e.name);
      file ??= f.file;
    }
  }
  return pending.size ? { count: pending.size, file, managed: isManaged(readOrNull(path.join(folder, file))) } : null;
}

const isPublic = (name) => name.startsWith("NEXT_PUBLIC_");

// The import preview's rows: every name in the files against the vault (has and get read it). Tails only. A file
// elsewhere ticks only names nothing nearer holds: never over the vault's value or the project's own.
/** @param {any[]} files @param {{ has: (name: string, env: string) => boolean, get: (name: string, env: string) => string | undefined }} vault */
function scanRows(files, vault) {
  const valued = valuedIn(files);
  const taken = valuedIn(files.filter((f) => !f.elsewhere));
  const rows = [];
  for (const f of files) {
    for (const e of f.entries) {
      const environment = f.kind.environment;
      const key = `${environment}\n${e.name}`;
      if (f.kind.namesOnly) {
        if (!vault.has(e.name, environment) && !valued.has(key)) rows.push({ file: f.file, name: e.name, environment, status: "missing", tail: "", public: isPublic(e.name), ticked: true, skipped: false });
        continue;
      }
      const st = status(vault.get(e.name, environment), e.value);
      const skipped = Boolean(f.vercel && shortLived(e.name));
      const ticked = f.kind.ticked && st !== "same" && !skipped && freeFrom(f, st, key, taken);
      rows.push({ file: f.file, name: e.name, environment, status: st, tail: tailOf(e.value), public: isPublic(e.name), ticked, skipped });
    }
  }
  return rows;
}

module.exports = { readFiles, status, nudge, scanRows };
