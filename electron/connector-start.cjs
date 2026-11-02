// Signing a card's start for weft.zip's GitHub connector (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust).
// When the desktop board starts a thread on a worker (lib/worker-new-thread.ts), the server asks main, over the
// token-guarded control server (`POST /connectors/sign-start`, electron/pairing-ipc.cjs), to sign
// {you, worker, card, folder, repo, time} with this Mac's approval key. Main signs only a repo it knows that folder as
// itself (electron/worker-projects.cjs reads this Mac's own checkouts), never the caller's word for it. No Touch ID
// per card: the grant (per worker, behind Touch ID) is the yes; this signature only says the card was started here,
// for that repo, so a session alone can't make a card.create that mints.
const crypto = require("node:crypto");
const { startMessage } = require("./connector-sign.cjs");

const CARD_RE = /^[A-Za-z0-9_-]{1,200}$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

/**
 * @param {{ userId: () => string | null, sign: (message: string) => Promise<string>, signKey: () => Promise<string>,
 *   projectRepos: (folder: string) => Promise<string[]>, now?: () => number }} deps
 */
function createStartSigner({ userId, sign, signKey, projectRepos, now = Date.now }) {
  /** @param {any} body @returns {Promise<{ key: string, sig: string, issuedAt: number, nonce: string }>} */
  return async (body) => {
    const uid = userId();
    if (!uid) throw new Error("Sign in to Weft first.");
    const { workerId, cardId, folder, repo } = body ?? {};
    if (typeof workerId !== "string" || !workerId || typeof cardId !== "string" || !CARD_RE.test(cardId) || typeof folder !== "string" || !folder || typeof repo !== "string" || !REPO_RE.test(repo)) {
      throw new Error("Name the worker, the card, the folder and the repo.");
    }
    const known = [...new Set(await projectRepos(folder))];
    if (known.length !== 1 || known[0] !== `github:${repo.toLowerCase()}`) throw new Error(`This Mac doesn't know ${folder} as ${repo}, so it won't sign that start.`);
    const issuedAt = now();
    // A fresh nonce, carried in the command row beside the signature: the mint pins a card to one signature once.
    const nonce = crypto.randomBytes(16).toString("hex");
    const sig = await sign(startMessage({ userId: uid, workerId, cardId, folder, repo, nonce, issuedAt }));
    return { key: await signKey(), sig, issuedAt, nonce };
  };
}

module.exports = { createStartSigner };
