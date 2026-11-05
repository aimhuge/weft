import fs from "node:fs";
import path from "node:path";

// Write a file so a crash or power cut mid-write leaves either the old contents or the new, never half of each:
// write a temp file beside it, fsync it so the bytes are on disk, then rename it over the target (atomic on one
// filesystem), then fsync the folder so the rename itself survives. lib/store.ts writes board.json this way.
export function writeFileAtomic(file: string, data: string): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  syncFolder(path.dirname(file));
}

// Best effort: the rename is already done, and some filesystems refuse to open or fsync a folder.
function syncFolder(dir: string): void {
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // The data is written; only the rename's durability across a power cut is left to the OS.
  }
}
