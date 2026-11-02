// What main remembers about a Weft Worker card's vault asks (electron/worker-vault.cjs), kept in ~/.weft/vault so a
// restart of Weft doesn't forget it (docs/architecture/project-hosts.md#the-vault-on-a-worker-t2-as-built):
// - the nonces it has answered, until each ask expires, sealed with safeStorage, so a signed ask copied into a new row
//   (anyone holding the worker's `wwk_` key can make one) is answered once only, across restarts too;
// - which project each card belongs to, pinned the first time it reaches the vault, and only for a card its owner made:
//   a card's folder on cloud_cards is the worker's word, so the card must come from a new_card, run or card.create
//   command the signed-in owner sent to that worker, naming the same folder.
// Both files are written to a temporary name and renamed into place, one write at a time.
const fs = require("node:fs");
const path = require("node:path");
const { MAX_AHEAD_MS } = require("./worker-ask.cjs");

// Writes the file whole: a temporary file beside it, then a rename, so a crash never leaves half of one.
function writeWhole(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * The nonces answered. A file that's there but won't open fails closed: no ask that could have been signed before main
 * read it is answered (`floor`), so garbling the file can't bring a spent ask back. No dir keeps them in memory only.
 * @param {{ dir?: string, safeStorage?: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string }, now?: () => number }} [deps]
 */
function createAskNonces({ dir, safeStorage, now = Date.now } = {}) {
  const file = dir ? path.join(dir, "vault", "worker-ask-nonces.json") : null;
  /** @type {Map<string, number> | null} */
  let kept = null;
  let floor = 0;

  function load() {
    if (!file || !safeStorage || !fs.existsSync(file)) return new Map();
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a map");
      return new Map(Object.entries(parsed).filter((e) => typeof e[1] === "number"));
    } catch {
      floor = now();
      return new Map();
    }
  }

  return {
    /** Spends an ask's nonce, or throws when it was spent already (or may have been, before main could know). */
    take(nonce, expiresAt) {
      kept ??= load();
      const at = now();
      for (const [n, until] of kept) if (until < at) kept.delete(n);
      if (kept.has(nonce) || (floor && expiresAt <= floor + MAX_AHEAD_MS)) throw new Error("That ask was already answered.");
      kept.set(nonce, expiresAt);
      if (file && safeStorage) writeWhole(file, safeStorage().encryptString(JSON.stringify(Object.fromEntries(kept))).toString("base64"));
    },
  };
}

// The commands that make a card on a worker: a run, a web new_card, or the board's card.create verb.
const MADE_BY = ["new_card", "run", "host"];
const makesCard = (row) => row.kind !== "host" || row.payload?.verb === "card.create";

/**
 * @param {{ dataDir: string }} deps
 * @returns {(supabase: any, uid: string, workerId: string, cardId: string, folder: string) => Promise<void>} throws when refused
 */
function createCardOrigins({ dataDir }) {
  const file = path.join(dataDir, "vault", "worker-card-folders.json");
  let queue = Promise.resolve();
  const read = () => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) ?? {};
    } catch {
      return {};
    }
  };

  async function check(supabase, uid, workerId, cardId, folder) {
    const key = `${workerId}\n${cardId}`;
    const was = read()[key];
    if (typeof was === "string") {
      if (was !== folder) throw new Error(`That card was in ${was} when it first reached the vault, and says ${folder} now, so this Mac won't answer it. Start a new card in ${folder}.`);
      return;
    }
    const { data, error } = await supabase.from("cloud_commands").select("kind, folder, payload, created_by").eq("target_device", `worker:${workerId}`).eq("card_id", cardId).eq("created_by", uid).in("kind", MADE_BY);
    if (error) throw new Error(`Couldn't check where that card came from: ${error.message}`);
    const made = (data ?? []).filter((r) => r.created_by === uid && makesCard(r));
    if (!made.length) throw new Error("This Mac only answers the vault for a worker card you started (from the board or weft.zip), and it can't find that card's start. Start a new card for this project, then try again.");
    if (!made.some((r) => r.folder === folder)) throw new Error(`That card was started in ${made[0].folder}, and says ${folder} now, so this Mac won't answer it.`);
    writeWhole(file, JSON.stringify({ ...read(), [key]: folder }));
  }

  // One check at a time, so two asks can't each read the file and the second write drop the first's pin.
  return (...args) => {
    const run = queue.then(() => check(...args));
    queue = run.catch(() => {});
    return run;
  };
}

module.exports = { createAskNonces, createCardOrigins, writeWhole };
