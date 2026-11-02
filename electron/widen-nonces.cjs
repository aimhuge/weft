// The nonces of the signed widenings this Mac has run (docs/architecture/project-hosts.md#signed-widening-as-built), kept
// by main rather than the Next server: a thread runs as the same user as the server, so a nonce file the server reads
// back is one a thread could rewrite to replay an approval inside its two minutes. Main's map in memory is what counts
// while it runs; the copy on disk, sealed with safeStorage in ~/.weft/vault/ (sealed from threads, lib/secret-guard-files.ts),
// only carries it across a restart. A copy that's missing or won't open fails closed: nothing signed before main read it
// runs (`floor`), so deleting or garbling the file can't bring a spent approval back.
const fs = require("node:fs");
const path = require("node:path");

// lib/widen.ts WIDEN_TTL_MS, plus a minute of slack: past that an approval is refused as too old anyway.
const KEEP_MS = 2 * 60_000 + 60_000;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }, now?: () => number }} deps
 */
function createWidenNonces({ dir, safeStorage, now = Date.now }) {
  const file = path.join(dir, "vault", "widen-nonces.json");
  /** @type {Map<string, number> | null} */
  let kept = null;
  let floor = 0;

  function load() {
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a map");
      return new Map(Object.entries(parsed).filter((e) => typeof e[1] === "number"));
    } catch {
      floor = now();
      return new Map();
    }
  }

  function save(map) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const plain = JSON.stringify(Object.fromEntries(map));
    fs.writeFileSync(file, safeStorage().encryptString(plain).toString("base64"), { mode: 0o600 });
  }

  /** Spends a nonce once its approval checked out: false when it was spent already, or signed before main could know. */
  function take({ nonce, issuedAt }) {
    if (typeof nonce !== "string" || !NONCE.test(nonce) || typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return false;
    kept ??= load();
    const at = now();
    for (const [n, until] of kept) if (until <= at) kept.delete(n);
    if (issuedAt < floor || kept.has(nonce)) return false;
    // Kept until the approval would be too old anyway; never longer than that from now, whatever its clock said.
    kept.set(nonce, Math.min(issuedAt + KEEP_MS, at + 2 * KEEP_MS));
    save(kept);
    return true;
  }

  return { take, file };
}

module.exports = { createWidenNonces, KEEP_MS };
