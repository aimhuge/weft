// weft.showExport for a page Weft's threads write under <dataDir>/show/ (plugin/skills/copy-edit): the page hands
// main a few files (a piece's markdown and its images) and main writes them to an export/ folder beside the page.
//
// Why: an editor page keeps the user's draft, pasted images included, in its own localStorage, which a thread can't
// read. With this the page keeps <its folder>/export/ current, so the thread reads files instead of asking the user to
// save each image by hand.
//
// The door is narrow: only the pane's own main frame, only a file: page inside show/ (never a page saved from a worker
// card), only into that page's export/ folder and its images/ subfolder, only text and image types, capped in count and
// size. An image may also be copied from a file beside the page (a screenshot a note put in), never from outside it.

const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { senderOk, isInside, isWorkerAppPage, WORKER_APP_REFUSED } = require("./app-data-frame.cjs");

const MAX_FILES = 60;
const MAX_BYTES = 60 * 1024 * 1024;
const NAME = /^(images\/)?[a-z0-9][a-z0-9._-]{0,95}\.(md|txt|json|png|jpe?g|gif|webp)$/i;

// The folder of the page asking, or null when it isn't a file: page inside <dataDir>/show/.
function pageFolder(dataDir, frameUrl) {
  try {
    if (!String(frameUrl).startsWith("file:")) return null;
    const file = fileURLToPath(frameUrl);
    return isInside(path.join(dataDir, "show"), file) ? path.dirname(fs.realpathSync(file)) : null;
  } catch {
    return null;
  }
}

// A file beside the page (or below it) to copy, by its src as the page wrote it; null for anything outside.
function besidePage(folder, src) {
  try {
    const rel = decodeURIComponent(String(src).split(/[?#]/)[0]);
    if (!rel || rel.startsWith("/") || /^[a-z]+:/i.test(rel)) return null;
    const file = path.resolve(folder, rel);
    return isInside(folder, file) && !isInside(path.join(folder, "export"), file) ? fs.realpathSync(file) : null;
  } catch {
    return null;
  }
}

// Each file as { name, body: Buffer }; throws on a bad name, a missing body or too much.
function cleanFiles(folder, raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error("Nothing to export.");
  if (raw.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files.`);
  let total = 0;
  const out = raw.map((f) => {
    const name = String(f?.name ?? "");
    if (!NAME.test(name) || name.includes("..")) throw new Error(`${name || "A file"} isn't a name export can write.`);
    let body;
    if (typeof f.text === "string") body = Buffer.from(f.text, "utf8");
    else if (typeof f.base64 === "string") body = Buffer.from(f.base64, "base64");
    else if (typeof f.from === "string") {
      const src = besidePage(folder, f.from);
      if (!src) throw new Error(`${f.from} isn't a file beside this page.`);
      body = fs.readFileSync(src);
    } else throw new Error(`${name} has nothing in it.`);
    total += body.length;
    return { name, body };
  });
  if (total > MAX_BYTES) throw new Error("The export is too big.");
  return out;
}

// Write the files to <folder>/export/, each only when it changed, and remove what an earlier export left that this
// one doesn't have (a removed image), so the folder is exactly the piece as it is now.
function writeExport(folder, files) {
  const dir = path.join(folder, "export");
  fs.mkdirSync(path.join(dir, "images"), { recursive: true });
  const keep = new Set(files.map((f) => f.name));
  let written = 0;
  for (const { name, body } of files) {
    const to = path.join(dir, name);
    if (fs.existsSync(to) && fs.readFileSync(to).equals(body)) continue;
    fs.writeFileSync(to, body);
    written++;
  }
  for (const sub of ["", "images/"]) {
    for (const entry of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
      const name = sub + entry.name;
      if (entry.isFile() && NAME.test(name) && !keep.has(name)) fs.rmSync(path.join(dir, name));
    }
  }
  return { ok: true, dir, files: files.length, written };
}

function registerShowExport(ipcMain, { owns, dataDir }) {
  ipcMain.handle("show-export:write", async (event, raw) => {
    if (!senderOk(owns, event)) throw new Error("Export only answers the pane's main frame.");
    const url = event.senderFrame?.url ?? "";
    if (isWorkerAppPage(dataDir, url)) throw new Error(WORKER_APP_REFUSED);
    const folder = pageFolder(dataDir, url);
    if (!folder) return { ok: false, error: "Only a page in Weft's show folder can export." };
    try {
      return writeExport(folder, cleanFiles(folder, raw));
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

module.exports = { registerShowExport, pageFolder, besidePage, cleanFiles, writeExport, MAX_FILES };
