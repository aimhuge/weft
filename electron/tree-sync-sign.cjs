// Synced folders (docs/architecture/folder-sync.md#trust): which of your worker's projects this Mac keeps as one folder
// with its own checkout, and this Mac's signature on each `tree` channel it opens to one.
//
// Turning sync on is the user's, with Touch ID: it lets the worker's line write into this Mac's checkout and this Mac's
// line write into the worker's, which is as strong as a shell there. The list is sealed with safeStorage in
// ~/.weft/vault/ (threads can't read or edit it). After that, opening a channel needs no prompt: the line drops and comes
// back whenever the board shows the worker, so main signs each open with this Mac's device key (as a LAN offer is,
// electron/lan-line-sign.cjs), but only for a folder on the list and a worker this Mac paired. What's signed is built
// here under its own prefix (lib/tree-sync-proof.ts openMessage, held together by electron/tree-sync-sign.test.ts), so the
// signature can only mean "this Mac opens sync of this folder on this worker, now". Turning sync off asks nothing.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PREFIX = "weft-tree-sync-v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLDER = /^[A-Za-z0-9._-]{1,200}$/;

// Main's copy of lib/tree-sync-proof.ts openMessage.
function openMessage(workerId, folder, issuedAt, nonce) {
  return [PREFIX, workerId.toLowerCase(), folder, String(issuedAt), nonce].join("\n");
}

function target(body) {
  const workerId = body?.workerId;
  const folder = body?.folder;
  if (typeof workerId !== "string" || !UUID.test(workerId)) throw new Error("That names no worker.");
  if (typeof folder !== "string" || !FOLDER.test(folder) || folder.startsWith(".")) throw new Error("That names no project.");
  return { workerId: workerId.toLowerCase(), folder };
}

/**
 * @param {{ dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string } }} deps
 */
function syncList({ dir, safeStorage }) {
  const file = path.join(dir, "vault", "tree-sync.json");
  /** @returns {{ workerId: string, folder: string, at: string }[]} */
  function list() {
    if (!fs.existsSync(file)) return [];
    try {
      const parsed = JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
      return Array.isArray(parsed.folders) ? parsed.folders : [];
    } catch {
      return [];
    }
  }
  function write(folders) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify({ folders })).toString("base64"), { mode: 0o600 });
  }
  const same = (a, b) => a.workerId === b.workerId && a.folder === b.folder;
  return {
    list,
    has: (t) => list().some((f) => same(f, t)),
    add: (t, at) => write([...list().filter((f) => !same(f, t)), { ...t, at }]),
    remove: (t) => write(list().filter((f) => !same(f, t))),
  };
}

/**
 * @param {{ list: ReturnType<typeof syncList>, pins: () => { pinned: (id: string) => { signKey?: string } | null }, signer: () => Promise<{ sign: (m: string) => string, publicKey: () => string }>, ask: (reason: string) => Promise<boolean>, now?: () => number }} deps
 */
function treeSyncRoutes({ list, pins, signer, ask, now = Date.now }) {
  const paired = (workerId) => Boolean(pins().pinned(workerId)?.signKey);
  return {
    "POST /tree-sync/list": () => ({ folders: list.list().map(({ workerId, folder }) => ({ workerId, folder })) }),
    "POST /tree-sync/enable": async (body) => {
      const t = target(body);
      if (!paired(t.workerId)) throw new Error("This Mac didn't pair that worker, so it can't sync a folder with it.");
      const name = typeof body?.workerName === "string" ? body.workerName.slice(0, 60) : "your worker";
      if (!(await ask(`keep ${t.folder} in sync with ${name}, so each can change the other's files`))) throw new Error("Sync wasn't turned on.");
      list.add(t, new Date(now()).toISOString());
      return { ok: true };
    },
    "POST /tree-sync/disable": (body) => {
      list.remove(target(body));
      return { ok: true };
    },
    "POST /tree-sync/sign": async (body) => {
      const t = target(body);
      if (!paired(t.workerId)) throw new Error("This Mac didn't pair that worker.");
      if (!list.has(t)) throw new Error(`Sync isn't on for ${t.folder}.`);
      const key = await signer();
      const issuedAt = now();
      const nonce = crypto.randomBytes(16).toString("hex");
      return { key: key.publicKey(), sig: key.sign(openMessage(t.workerId, t.folder, issuedAt, nonce)), issuedAt, nonce };
    },
  };
}

module.exports = { treeSyncRoutes, syncList, openMessage };
