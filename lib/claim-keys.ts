// The claim key's parts, in a file of pure functions.
//
// They live here, not in lib/claims.ts, because the board's thread panel lists who waits on whom
// (lib/waits-on.ts, a "use client" module) and needs a claim key's file name — and lib/claims.ts imports
// node:path for the clash question's last segment. A type-only or value import of a server module still
// makes Turbopack resolve it, and a browser chunk can't hold node:path, so the whole board failed to
// compile. These functions use no Node API: a path's last segment is its own "/" split.

export const WHOLE_FILE = "*";

// A path's own # is escaped (and %, so it reads back), so a key's first # is where its symbol starts:
// symbols hold # of their own, order numbers anywhere along them (`Board/return/div#2/main`).
export function claimKey(file: string, symbol: string = WHOLE_FILE) {
  return `${file.replace(/%/g, "%25").replace(/#/g, "%23")}#${symbol}`;
}

// The escapes a key's path carries, read back.
const unescape = (file: string) => file.replace(/%23/g, "#").replace(/%25/g, "%");

// A key's file and symbol.
export function splitClaim(key: string) {
  const at = key.indexOf("#");
  if (at < 0) return { file: unescape(key), symbol: WHOLE_FILE };
  return { file: unescape(key.slice(0, at)), symbol: key.slice(at + 1) };
}

// A claim key's file name: its file's last segment, unescaped. A key without a symbol (a bare path)
// still names its file.
export function claimFileName(key: string) {
  const file = splitClaim(key).file;
  return file.slice(file.lastIndexOf("/") + 1);
}

// A path's last segment, the way path.basename does for the paths Weft holds: a trailing slash
// doesn't count as the name.
export function baseName(file: string) {
  const trimmed = file.endsWith("/") ? file.slice(0, -1) : file;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}
