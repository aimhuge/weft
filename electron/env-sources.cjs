// Where a vault's .env files live besides the project folder (docs/architecture/secrets.md#found-elsewhere): copies
// of the project beside it (~/dev/weft-build beside ~/dev/weft), the repo's git worktrees, and the files you
// located by hand with Locate… (remembered per vault in ~/.weft/env-sources.json). Main finds every one of them
// itself, from the disk or a native file dialog, so the board still can't name a path for the vault to read.
const fs = require("node:fs");
const path = require("node:path");
const { envFileKind, findEnvFiles, isVercelPull, parseEnv } = require("./dotenv.cjs");

const MAX_NEARBY = 12;
// A located file can be called anything (secrets.env, prod.env): it feeds development unless its name says otherwise.
const ANY_FILE = { environment: "development", namesOnly: false, ticked: true };

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const readOr = (file, fallback) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
};

// b is a copy of a when one name is the other plus a separator and more: weft and weft-build, app and app.old.
function copyName(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short !== long && long.startsWith(short) && /[-_. ]/.test(long[short.length]);
}

// The repo's other worktrees: from the main checkout's .git/worktrees/*/gitdir, found from either side.
function worktrees(folder) {
  const dotGit = path.join(folder, ".git");
  const pointer = /^gitdir:\s*(.+)$/m.exec(readOr(dotGit, ""));
  // In a worktree .git is a file naming <main>/.git/worktrees/<name>; in the main checkout it's the folder itself.
  const common = pointer ? path.resolve(folder, pointer[1].trim(), "..", "..") : dotGit;
  const found = path.basename(common) === ".git" && fs.existsSync(common) ? [path.dirname(common)] : [];
  for (const entry of listDir(path.join(common, "worktrees"))) {
    const gitdir = readOr(path.join(common, "worktrees", entry.name, "gitdir"), "").trim();
    if (gitdir) found.push(path.dirname(gitdir));
  }
  return found;
}

// Folders that hold another copy of the project, nearest first: siblings by name, then worktrees. skip holds
// folders never to look in (Weft's own worktree pool).
/** @param {string} folder @param {{ skip?: string[] }} [opts] */
function nearbyFolders(folder, { skip = [] } = {}) {
  const parent = path.dirname(folder);
  const base = path.basename(folder);
  const out = new Set();
  for (const entry of listDir(parent)) {
    if (entry.isDirectory() && copyName(base, entry.name)) out.add(path.join(parent, entry.name));
  }
  for (const tree of worktrees(folder)) out.add(tree);
  out.delete(folder);
  return [...out].filter((dir) => !skip.some((s) => dir === s || dir.startsWith(s + path.sep))).slice(0, MAX_NEARBY);
}

// The files you located, by vault id, as absolute paths.
function createLocated({ file }) {
  const read = () => {
    try {
      const all = JSON.parse(fs.readFileSync(file, "utf8"));
      return all && typeof all === "object" ? all : {};
    } catch {
      return {};
    }
  };
  return {
    get: (id) => (Array.isArray(read()[id]) ? read()[id].filter((f) => typeof f === "string") : []),
    add(id, abs) {
      const all = read();
      all[id] = [...new Set([...(Array.isArray(all[id]) ? all[id] : []), abs])];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
    },
  };
}

// The env files outside the project's own, as paths relative to it with what each feeds: the ones you located
// first, then the .env files with values in copies beside it (a copy's .env.example isn't this project's list).
function elsewhereFiles(folder, located = [], opts = {}) {
  const own = new Set(findEnvFiles(folder).map((f) => path.join(folder, f)));
  const seen = new Set();
  const files = [];
  const add = (abs, kind) => {
    if (!kind || own.has(abs) || seen.has(abs) || !fs.existsSync(abs)) return;
    seen.add(abs);
    files.push({ file: path.relative(folder, abs), kind });
  };
  for (const abs of located) add(abs, envFileKind(abs) ?? ANY_FILE);
  for (const dir of nearbyFolders(folder, opts)) {
    for (const rel of findEnvFiles(dir)) {
      const kind = envFileKind(rel);
      if (!kind.namesOnly) add(path.join(dir, rel), kind);
    }
  }
  return files;
}

// Every env file the vault's import reads, parsed: the project's own, then the ones elsewhere (elsewhere: true).
function readEnvFiles(folder, located = [], opts = {}) {
  const own = findEnvFiles(folder).map((file) => ({ file, kind: envFileKind(file), elsewhere: undefined }));
  const others = elsewhereFiles(folder, located, opts).map((f) => ({ ...f, elsewhere: true }));
  return [...own, ...others].flatMap((f) => {
    const text = readOr(path.join(folder, f.file), null);
    return text === null ? [] : [{ ...f, vercel: isVercelPull(text), entries: parseEnv(text) }];
  });
}

// "environment\nNAME" for every value the files hold (a names-only file holds none).
const valuedIn = (files) => new Set(files.filter((f) => !f.kind.namesOnly).flatMap((f) => f.entries.map((e) => `${f.kind.environment}\n${e.name}`)));

// Whether a row may start ticked, as far as its file goes: one from elsewhere only when the name is new to the vault
// and nothing nearer holds it (the first such file wins). Marks the name taken.
function freeFrom(f, status, key, taken) {
  if (!f.elsewhere) return true;
  const free = status === "new" && !taken.has(key);
  taken.add(key);
  return free;
}

// Locate…: asks main's file dialog for an env file and remembers it for the vault. Null when you cancel, empty
// when the file holds no NAME=value lines (so a stray pick, like a key file, is never kept).
/** @typedef {(o: { title: string, defaultPath: string }) => Promise<string | null>} PickFile */
/** @param {{ pickFile: PickFile, located: { add: (id: string, abs: string) => void }, id: string, folder: string, label: string, log?: (entry: Record<string, unknown>) => unknown }} args */
async function locateFile({ pickFile, located, id, folder, label, log }) {
  const abs = await pickFile({ title: `Locate an env file for ${label}`, defaultPath: path.dirname(folder) });
  if (!abs) return null;
  if (!parseEnv(readOr(abs, "")).length) return { empty: true, file: path.basename(abs) };
  located.add(id, path.resolve(abs));
  const file = path.relative(folder, path.resolve(abs));
  log?.({ action: "locate", by: "you", vault: label, names: [], detail: file });
  return { file };
}

// Locate…'s native file dialog, hidden files shown (most env files start with a dot). The path never leaves main.
const openEnvDialog = (dialog, window) => async ({ title, defaultPath }) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(window(), { title, defaultPath, buttonLabel: "Use This File", properties: ["openFile", "showHiddenFiles"] });
  return canceled ? null : filePaths[0];
};

module.exports = { freeFrom, valuedIn, openEnvDialog, copyName, worktrees, nearbyFolders, createLocated, elsewhereFiles, readEnvFiles, locateFile, ANY_FILE };
