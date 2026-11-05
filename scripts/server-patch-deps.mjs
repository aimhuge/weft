// The fingerprint of a standalone server's node_modules: every file's path and size, sorted and hashed.
// A full build writes it beside the server (weft-deps.json, from prepare-standalone.mjs); a server patch carries the
// fingerprint it was built against, and an installed Weft takes the patch only when the two match, because the patch
// ships the server's own code and borrows the app's packages (docs/architecture/updates.md#server-patches).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEPS_FILE = "weft-deps.json";

// Every file under a node_modules folder as "path size" (a link as "path -> target"), so a patch is refused
// both when a package moved to another version and when the new code needs a file the app's trace left out.
export function listFiles(dir, rel = "") {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) out.push(`${name} -> ${fs.readlinkSync(full)}`);
    else if (entry.isDirectory()) out.push(...listFiles(full, name));
    else out.push(`${name} ${fs.statSync(full).size}`);
  }
  return out;
}

// { hash, files } for a standalone folder's node_modules.
export function depsFingerprint(standalone) {
  const files = listFiles(path.join(standalone, "node_modules")).sort();
  const hash = crypto.createHash("sha256").update(files.join("\n")).digest("hex");
  return { hash, files: files.length };
}

export function writeDepsFile(standalone) {
  const fingerprint = depsFingerprint(standalone);
  fs.writeFileSync(path.join(standalone, DEPS_FILE), `${JSON.stringify(fingerprint, null, 2)}\n`);
  return fingerprint;
}
