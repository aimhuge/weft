// The 🔐 side of the project intake (lib/project-intake.ts, docs/architecture/secrets.md#project-intake): when a
// project opens, the new values in its untracked .env files go into the vault with no click, and the names its code
// reads (or its .env.example lists) come in as blanks with a hint. It never overwrites a value the vault holds (one
// that differs stays the rail's nudge), never imports from a file git tracks (those values are in history: rotate
// them), and skips what an earlier intake already offered, so a secret or blank the user removed stays removed.
// Names and file names come back, never a value.
const { findEnvFiles } = require("./dotenv.cjs");

const MAX_BLANKS = 25;
const importKey = (r) => `env\n${r.file}\n${r.name}\n${r.environment}`;
const blankKey = (name) => `blank\n${name}`;

// The intake's blanks as main takes them: valid-looking names only, hints and sources cut to size.
function cleanBlanks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((b) => b && typeof b.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(b.name))
    .map((b) => ({ name: b.name, hint: typeof b.hint === "string" ? b.hint.slice(0, 400) : undefined, source: String(b.source || "the intake").slice(0, 60) }))
    .slice(0, MAX_BLANKS);
}

async function intakeVault(vault, folder, { blanks = [], skip = [] } = {}) {
  const skipped = new Set(skip);
  const hasFiles = findEnvFiles(folder).length > 0;
  if (!hasFiles && !blanks.length) return { imported: [], blanked: [], tracked: [], keys: [] };
  const scan = hasFiles ? await vault.scan(folder) : { files: [], rows: [] };
  const trackedFiles = new Set(scan.files.filter((f) => f.tracked && !f.namesOnly).map((f) => f.file));
  const fresh = scan.rows.filter((r) => r.ticked && r.status === "new" && !skipped.has(importKey(r)));
  const picks = fresh.filter((r) => !trackedFiles.has(r.file));
  if (picks.length) await vault.importPicks(folder, picks.map(({ file, name }) => ({ file, name })));

  // A name any .env file holds a value for is the import's business, not a blank's.
  const { secrets } = await vault.names(folder);
  const known = new Set([...secrets.map((s) => s.name), ...scan.rows.filter((r) => r.status !== "missing").map((r) => r.name)]);
  const wanted = blanks.filter((b, i) => !known.has(b.name) && !skipped.has(blankKey(b.name)) && blanks.findIndex((o) => o.name === b.name) === i);
  const groups = new Map();
  for (const b of wanted) {
    const key = `${b.source}\n${b.hint ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  for (const group of groups.values()) {
    await vault.addBlanks(folder, group.map((b) => b.name), ["development"], { source: group[0].source, hint: group[0].hint });
  }
  // addBlanks tells the board itself; an import alone doesn't, so the 🔐 count wouldn't move until a focus.
  if (picks.length && !wanted.length) vault.notify?.(folder);

  const tracked = [...new Set(fresh.filter((r) => trackedFiles.has(r.file)).map((r) => r.file))];
  return {
    imported: picks.map(({ file, name, environment }) => ({ file, name, environment })),
    blanked: wanted.map((b) => b.name),
    tracked,
    keys: [...picks.map(importKey), ...wanted.map((b) => blankKey(b.name))],
  };
}

module.exports = { intakeVault, cleanBlanks };
