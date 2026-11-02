// Connector sign-ins lent to a Weft Worker (docs/architecture/project-hosts.md#the-vault-and-connectors-on-a-worker-t2-as-built).
// Settings → Devices turns gog (Google) or gh (GitHub) on for one paired worker, after Touch ID that says what it gives
// and to which box. This Mac keeps that choice sealed with safeStorage in ~/.weft/vault/worker-connectors.json, mints a
// short-lived token from its own sign-in (electron/connector-mint.cjs), seals it to the worker's pinned box key and signs
// the `connector` command with its device key, so only that worker opens it and it takes it only from this Mac. It sends
// a fresh one before the last runs out, for as long as the connector stays on and the worker isn't revoked. Turning it
// off sends a signed forget. Every send re-reads the worker's row: a revoked, removed or re-keyed worker gets nothing.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { CONNECTORS, connectorMessage, connectorPurpose, isConnector } = require("./connector-wire.cjs");
const { GH_LOGIN } = require("./connector-mint.cjs");
const { seal } = require("./worker-seal.cjs");

// How often a token goes again: Google's last an hour, gh's are forgotten on the worker after 8 hours.
const REFRESH_MS = { gog: 40 * 60_000, gh: 6 * 60 * 60_000 };
const EMAIL = /^[^\s@]{1,200}@[^\s@]{1,100}\.[^\s@]{1,60}$/;

/**
 * @param {{
 *   dir: string, safeStorage: () => { encryptString: (s: string) => Buffer, decryptString: (b: Buffer) => string },
 *   db: () => any, userId: () => string,
 *   pins: { lookup: (w: { id: string, name: string, publicKey: string }) => { publicKey: string, signKey?: string, firstUse: boolean } },
 *   signer: () => Promise<{ publicKey: () => string, sign: (message: string) => string }>,
 *   mint: { gog: (account: string) => Promise<{ token: string, account: string, expiresAt: number }>, gh: (account: string) => Promise<{ token: string, account: string, expiresAt: number }>, ghAccount: () => Promise<string>, forget: (account: string) => void },
 *   confirm: (reason: string) => Promise<boolean>,
 *   now?: () => number, log?: (message: string) => void,
 * }} deps
 */
function createWorkerConnectors({ dir, safeStorage, db, userId, pins, signer, mint, confirm, now = Date.now, log = console.warn }) {
  const file = path.join(dir, "vault", "worker-connectors.json");
  const sent = new Map();
  let last = 0;

  /** @returns {Record<string, Record<string, { account: string, since: string }>>} */
  function read() {
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(safeStorage().decryptString(Buffer.from(fs.readFileSync(file, "utf8"), "base64")));
    } catch {
      throw new Error("This Mac's worker connectors won't open. Remove ~/.weft/vault/worker-connectors.json and turn them on again.");
    }
  }
  const write = (grants) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, safeStorage().encryptString(JSON.stringify(grants)).toString("base64"), { mode: 0o600 });
  };

  // The worker's row as the owner reads it, and its keys as this Mac pinned them at pairing.
  async function workerOf(id) {
    const { data: w } = await db().from("cloud_workers").select("id, org_id, name, owner_user, kind, public_key, sign_key, revoked_at").eq("id", String(id)).maybeSingle();
    if (!w || w.owner_user !== userId() || w.kind !== "headless") throw new Error("That worker isn't yours.");
    if (w.revoked_at) throw new Error(`${w.name} was revoked.`);
    const pin = pins.lookup({ id: w.id, name: w.name, publicKey: w.public_key });
    if (pin.firstUse || !pin.signKey || pin.signKey !== w.sign_key) throw new Error(`${w.name} isn't paired with this Mac, so it gets no connectors. Pair it from Settings → Devices → Add a worker.`);
    return { worker: w, pin };
  }

  async function send(worker, op, connector, sealed, nonce, issuedAt) {
    const key = await signer();
    const mac = { key: key.publicKey(), sig: key.sign(connectorMessage(op, connector, nonce, issuedAt, sealed)) };
    const payload = { op, connector, nonce, issuedAt, ...(sealed ? { sealed } : {}), mac };
    const { error } = await db().from("cloud_commands").insert({ org_id: worker.org_id, kind: "connector", target_device: `worker:${worker.id}`, folder: "-", payload });
    if (error) throw new Error(`Couldn't send it to ${worker.name}: ${error.message}`);
  }
  // Strictly later than anything sent before: the worker refuses a command no newer than the one it has.
  const issued = () => (last = Math.max(now(), last + 1));

  async function push(workerId, connector) {
    const grant = read()[workerId]?.[connector];
    if (!grant) return false;
    const { worker, pin } = await workerOf(workerId);
    const t = await mint[connector](grant.account);
    const nonce = crypto.randomBytes(32).toString("hex");
    const issuedAt = issued();
    const plaintext = JSON.stringify({ v: 1, connector, account: t.account, token: t.token, expiresAt: t.expiresAt, issuedAt });
    await send(worker, "token", connector, seal(pin.publicKey, plaintext, connectorPurpose(connector, nonce)), nonce, issuedAt);
    sent.set(`${workerId}\n${connector}`, now());
    return true;
  }

  async function accountFor(connector, account) {
    const a = connector === "gh" ? String(account || (await mint.ghAccount())) : String(account ?? "");
    if (!(connector === "gh" ? GH_LOGIN : EMAIL).test(a)) throw new Error("That isn't an account Weft can lend.");
    return a;
  }

  const prompt = (worker, connector, account) =>
    `give the Weft Worker ${worker.name} your ${CONNECTORS[connector].label} sign-in (${account}): every card on it can use it until you turn it off in Settings → Devices. ${connector === "gh" ? "GitHub's token itself doesn't expire: if the worker is ever lost, sign gh out here (gh auth refresh) to retire it." : "It gets an hour-long token at a time, sent only while this Mac is on and signed in."}`;

  return {
    list: () => Object.entries(read()).flatMap(([workerId, byConnector]) => Object.entries(byConnector).map(([connector, g]) => ({ workerId, connector, account: g.account, since: g.since }))),

    /** Touch ID, then the grant, then the first token. @param {string} workerId @param {string} connector @param {string} [account] */
    async enable(workerId, connector, account) {
      if (!isConnector(connector)) throw new Error("Unknown connector.");
      const { worker } = await workerOf(workerId);
      const who = await accountFor(connector, account);
      if (!(await confirm(prompt(worker, connector, who)))) return { denied: true };
      const grants = read();
      write({ ...grants, [workerId]: { ...grants[workerId], [connector]: { account: who, since: new Date(now()).toISOString() } } });
      await push(workerId, connector);
      return { enabled: true, account: who };
    },

    /** Off: the grant goes here, and the worker is told to forget its token. No Touch ID: it only takes access away. */
    async disable(workerId, connector) {
      const grants = read();
      const account = grants[workerId]?.[connector]?.account;
      if (grants[workerId]) delete grants[workerId][connector];
      write(grants);
      sent.delete(`${workerId}\n${connector}`);
      if (connector === "gog" && account) mint.forget(account);
      try {
        const { worker } = await workerOf(workerId);
        await send(worker, "forget", connector, null, crypto.randomBytes(32).toString("hex"), issued());
        return { disabled: true };
      } catch (err) {
        return { disabled: true, note: `${err.message} Its token runs out on its own.` };
      }
    },

    /** Sends each connector that's on a fresh token when its last is due; drops the grants of a worker that's gone. */
    async refresh() {
      if (!userId()) return;
      for (const { workerId, connector } of this.list()) {
        if (now() - (sent.get(`${workerId}\n${connector}`) ?? 0) < REFRESH_MS[connector]) continue;
        await push(workerId, connector).catch((err) => {
          log(`Worker connectors: ${connector} for ${workerId}: ${err.message}`);
          if (/isn't yours|was revoked/.test(err.message)) this.forgetWorker(workerId);
        });
      }
    },

    forgetWorker(workerId) {
      const grants = read();
      delete grants[workerId];
      write(grants);
    },
  };
}

module.exports = { createWorkerConnectors, REFRESH_MS };
