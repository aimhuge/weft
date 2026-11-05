// A folder's size as "123 MB", in Node, since `du` isn't there on Windows (the build scripts print it).
import fs from "node:fs";
import path from "node:path";

export function dirBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

export const dirSize = (dir) => `${Math.round(dirBytes(dir) / 1e6)} MB`;
