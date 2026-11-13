// Dev mode's fast-forward when git refuses one only because other cards' uncommitted edits sit in files the new
// commits also change (dev-update.cjs pull()). Git won't fast-forward over a dirty file even when the two sides touch
// different paragraphs, so each such file is test-merged first with `git merge-file` (ours = the working copy, base =
// HEAD's version, theirs = the target's). All clean: the working copies are backed up under ~/.weft/update-backups,
// put back to HEAD, the fast-forward runs, and the merged text is written over the new version, so each card's
// edits stay uncommitted on top of the update. Any conflict: nothing is touched, and the error names the files and
// the open cards that edited them. Never a stash, a rebase or a merge commit. docs/architecture/updates.md#dev-mode.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GIT_MS = 60_000;
const REFUSED = /Your local changes to the following files would be overwritten by (?:merge|checkout):/;

// The files git's refusal lists (tab-indented lines after the header), or null when it refused for another reason.
function refusedFiles(message) {
  const text = String(message || "");
  if (!REFUSED.test(text)) return null;
  const after = text.slice(text.search(REFUSED)).split("\n").slice(1);
  const files = [];
  for (const line of after) {
    if (!/^\s/.test(line) || !line.trim()) break;
    files.push(line.trim());
  }
  return files.length ? files : null;
}

// "a", "a and b", "a, b and c".
function listLine(items) {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The readable refusal: which files, which cards edited them, and what to do.
function conflictMessage(files, editors = {}) {
  const named = files.map((f) => {
    const cards = editors[f] || [];
    return cards.length ? `${f} (${listLine(cards.map((t) => `“${t}”`))})` : f;
  });
  const anyCards = files.some((f) => (editors[f] || []).length);
  const who = anyCards ? "Open cards' uncommitted edits to" : "Uncommitted edits to";
  return `${who} ${listLine(named)} change the same lines as origin/main, so Weft can't update without overwriting them. Commit those cards, then check again.`;
}

// Which open cards edited each file, from the board's touchedFiles (absolute paths). Empty when the server is down.
function cardsEditingFrom({ getServer, dir, fetchImpl = fetch, headers }) {
  return async (files) => {
    const server = getServer?.();
    if (!server) return {};
    try {
      const { cards = [] } = await (await fetchImpl(`${server.url}/api/cards`, headers)).json();
      const open = cards.filter((c) => !c.archived && c.column !== "done" && c.role !== "copilot");
      return Object.fromEntries(
        files.map((f) => [f, open.filter((c) => (c.touchedFiles || []).includes(path.join(dir, f))).map((c) => c.title || c.id)]),
      );
    } catch {
      return {};
    }
  };
}

const stamp = (now) => new Date(now).toISOString().replace(/[:.]/g, "-");

// Fast-forwards to `target` over dirty `files` by merging each one, or throws without touching anything.
async function mergeOverDirty({ dir, run, target, files, backupRoot, cardsEditing = async () => ({}), now = Date.now }) {
  const raw = (args) => run("git", args, { cwd: dir, timeoutMs: GIT_MS });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-update-merge-"));
  const merged = {};
  const ours = {};
  const conflicts = [];
  try {
    for (const [i, f] of files.entries()) {
      try {
        ours[f] = fs.readFileSync(path.join(dir, f), "utf8");
        const base = path.join(tmp, `${i}.base`);
        const theirs = path.join(tmp, `${i}.theirs`);
        fs.writeFileSync(base, await raw(["show", `HEAD:${f}`]));
        fs.writeFileSync(theirs, await raw(["show", `${target}:${f}`]));
        // Exits with the number of conflicts, so a conflict rejects; -p prints the result and leaves the file alone.
        merged[f] = await raw(["merge-file", "-p", "-L", "yours", "-L", "HEAD", "-L", "origin/main", path.join(dir, f), base, theirs]);
      } catch {
        conflicts.push(f);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (conflicts.length) throw new Error(conflictMessage(conflicts, await cardsEditing(conflicts)));

  const backup = path.join(backupRoot, stamp(now()));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(backup, f)), { recursive: true });
    fs.writeFileSync(path.join(backup, f), ours[f]);
  }
  const putBack = (content) => files.forEach((f) => fs.writeFileSync(path.join(dir, f), content[f]));
  try {
    await raw(["checkout", "HEAD", "--", ...files]);
    await raw(["merge", "--ff-only", target]);
  } catch (err) {
    putBack(ours);
    throw err;
  }
  putBack(merged);
  return { merged: files, backup };
}

module.exports = { refusedFiles, conflictMessage, cardsEditingFrom, mergeOverDirty };
