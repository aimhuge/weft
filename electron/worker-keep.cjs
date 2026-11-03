// "Keep on this worker" (docs/architecture/secrets.md#kept-on-a-worker): main sends a project's development or preview
// secrets to a paired Weft Worker, and takes them back. Settings → Devices calls these over IPC, board window only
// (registerWorkerKeep). Adding values asks Touch ID after the board's warning, and seals each one to the box key this Mac
// pinned for the worker (never the row's word); every command is signed with this Mac's device key, which the worker
// checks against the Mac its pairing code named. Taking values away (Stop, a secret changed or removed here, Wipe before
// a revoke) is signed without Touch ID: it can only narrow what the worker holds. What was sent is kept in the record
// (electron/worker-kept.cjs), which a use reads to decide what still travels.
const { LOADER_VAR } = require("./command-rules.cjs");
const { seal } = require("./worker-seal.cjs");
const { KEEP_ENVIRONMENTS, KEEP_KIND, keepMessage, keptPurpose } = require("./worker-keep-wire.cjs");
const { sha } = require("./worker-kept.cjs");

const MAX_KEPT = 200;
const ID = /^[A-Za-z0-9_:.-]{1,200}$/;
const REPO = /^github:[a-z0-9._-]{1,100}\/[a-z0-9._-]{1,100}$/;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {{
 *   record: ReturnType<typeof import("./worker-kept.cjs").createKeptRecord>,
 *   pins: { pinned: (id: string) => { publicKey?: string, signKey?: string } | null },
 *   signer: { sign: (message: string) => string, publicKey: () => string },
 *   db: () => any, userId: () => string,
 *   vault: { valuesFor: (folder: string, names: string[] | null, environment: string, use: false) => Promise<{ id: string, label: string, values: Record<string, string> }> },
 *   repoFolders: () => Promise<{ id: string, label: string, path: string }[]>,
 *   confirm: (reason: string) => Promise<boolean>,
 *   audit?: (entry: Record<string, unknown>) => unknown,
 *   log?: (msg: string) => void,
 *   now?: () => number,
 * }} deps
 */
function createWorkerKeep({ record, pins, signer, db, userId, vault, repoFolders, confirm, audit = (e) => e, log = console.warn, now = Date.now }) {
  async function workerRow(id) {
    if (typeof id !== "string" || !ID.test(id)) throw new Error("That names no worker.");
    const { data: w } = await db().from("cloud_workers").select("id, name, org_id, owner_user, public_key, revoked_at").eq("id", id).maybeSingle();
    if (!w || w.owner_user !== userId()) throw new Error("That worker isn't yours.");
    return w;
  }

  // Only grows, per worker, and survives a lost record: a worker refuses a seq at or below the one it holds.
  const nextSeq = (worker) => Math.max(now(), (Number(record.read()[worker]?.seq) || 0) + 1);

  async function queue(w, body, seq = nextSeq(w.id)) {
    const keep = { worker: w.id, seq, issuedAt: now(), ...body };
    const mac = { key: signer.publicKey(), sig: signer.sign(keepMessage(keep)) };
    const { error } = await db().from("cloud_commands").insert({ org_id: w.org_id, kind: KEEP_KIND, target_device: `worker:${w.id}`, folder: "-", payload: { keep, mac } });
    if (error) throw new Error(`Couldn't reach ${w.name}: ${error.message}`);
    return seq;
  }

  // A narrowing: signed and sent without Touch ID, then the record forgets it. A revoked worker can't take it (its key
  // was replaced); it wipes itself when its heartbeat finds that out (lib/worker-kept-vault.ts wipeWhenRevoked).
  async function narrow(worker, body, forget) {
    const w = await workerRow(worker);
    const seq = w.revoked_at ? null : await queue(w, body);
    record.update(w.id, (r) => {
      if (seq) r.seq = seq;
      forget(r);
    });
    audit({ kind: "vault", action: `worker keep ${body.op}`, by: "you", vault: body.repo, names: body.names, environment: body.environment, worker: w.name, outcome: "ok" });
    return { sent: Boolean(seq), name: w.name };
  }

  const dropEnv = (r, repo, environment) => {
    const envs = r.keeps[repo]?.envs ?? {};
    delete envs[environment];
    if (!Object.keys(envs).length) delete r.keeps[repo];
  };

  return {
    /** What this Mac keeps on a worker (names only), and the repos it could keep. */
    async list(worker) {
      const keeps = record.read()[String(worker)]?.keeps ?? {};
      const kept = Object.entries(keeps).flatMap(([repo, k]) => Object.entries(k?.envs ?? {}).map(([environment, slots]) => ({ repo, label: String(k.label ?? repo), environment, names: Object.keys(slots ?? {}).sort() })));
      const repos = (await repoFolders()).map(({ id, label }) => ({ id, label }));
      return { kept, repos, environments: KEEP_ENVIRONMENTS };
    },

    /** Sends (or sends again) a project's whole development or preview set to a worker, after Touch ID. */
    async keep({ worker, repo, environment } = {}) {
      if (!KEEP_ENVIRONMENTS.includes(environment)) throw new Error("Only development and preview secrets can stay on a worker: production values travel per use, after Touch ID.");
      if (typeof repo !== "string" || !REPO.test(repo)) throw new Error("That names no GitHub repo's vault.");
      const w = await workerRow(worker);
      if (w.revoked_at) throw new Error(`${w.name} was revoked.`);
      const pin = pins.pinned(w.id);
      if (!pin?.publicKey || !pin.signKey) throw new Error(`${w.name} has no box key pinned on this Mac yet. A paired worker's first approved secret ask pins it; then try again.`);
      if (pin.publicKey !== w.public_key) throw new Error(`${w.name}'s key changed since this Mac pinned it, so nothing is kept there. Re-pin it in Settings → Devices first.`);
      const project = (await repoFolders()).find((p) => p.id === repo);
      if (!project) throw new Error("This Mac has no checkout of that repo.");
      const { id, label, values: all } = await vault.valuesFor(project.path, null, environment, false);
      // The checkout's remote may have moved since it was listed: only that repo's vault goes under that repo's name.
      if (id !== repo) throw new Error(`This Mac's checkout of ${project.label} now names another repo's vault. Open Settings → Devices again.`);
      // A variable that loads code (NODE_OPTIONS, DYLD_*) never goes to a worker, as a dev server's env.
      const names = Object.keys(all).filter((n) => !LOADER_VAR.test(n)).sort();
      if (!names.length) return { none: true, label };
      if (names.length > MAX_KEPT) throw new Error(`${label} has ${names.length} ${environment} secrets; a worker keeps at most ${MAX_KEPT}.`);
      const reason = `keep ${plural(names.length, `${environment} secret`)} of ${label} on the worker ${w.name}. Any code a thread runs there can read them`;
      if (!(await confirm(reason))) return { denied: true, label };
      const seq = nextSeq(w.id);
      const entries = names.map((name) => ({ name, version: seq, sealed: seal(pin.publicKey, all[name], keptPurpose(w.id, repo, environment, name, seq)) }));
      await queue(w, { op: "put", repo, environment, entries }, seq);
      record.update(w.id, (r) => {
        r.seq = seq;
        r.keeps[repo] = { label, envs: { ...(r.keeps[repo]?.envs ?? {}), [environment]: Object.fromEntries(entries.map((e) => [e.name, { version: e.version, sha: sha(all[e.name]) }])) } };
      });
      audit({ kind: "vault", action: "keep on worker", by: "you", vault: label, names, environment, worker: w.name, outcome: "ok" });
      return { kept: names, label };
    },

    /** Turns "Keep on this worker" off for one project and environment: the worker deletes its copy. */
    stop({ worker, repo, environment } = {}) {
      if (typeof repo !== "string" || !REPO.test(repo) || !KEEP_ENVIRONMENTS.includes(environment)) throw new Error("That names nothing kept.");
      return narrow(worker, { op: "drop", repo, environment }, (r) => dropEnv(r, repo, environment));
    },

    /** Everything this Mac kept on the worker, gone: before a revoke, or by hand. */
    wipe(worker) {
      return narrow(worker, { op: "wipe" }, (r) => {
        r.keeps = {};
      });
    },

    /** A secret changed or removed in a vault on this Mac: every worker that kept it deletes its copy (no Touch ID). */
    async changed(repo, name, environment) {
      for (const [worker, r] of Object.entries(record.read())) {
        if (!r?.keeps?.[repo]?.envs?.[environment]?.[name]) continue;
        await narrow(worker, { op: "delete", repo, environment, names: [name] }, (w) => {
          delete w.keeps[repo]?.envs?.[environment]?.[name];
        }).catch((err) => log(`Weft: taking ${name} off a worker: ${err.message}`));
      }
    },
  };
}

// The vault's own writes tell the keeper: a value set or removed here takes the worker's copy away at once, so a stale
// (maybe leaked, now rotated) value doesn't sit on the worker. The new value goes again on the next Keep, after Touch ID.
/** @param {any} vault @param {(repo: string, name: string, environment: string) => Promise<void>} changed */
function watchVault(vault, changed) {
  const { setValue, remove } = vault;
  vault.setValue = async (folder, name, environment, ...rest) => {
    const result = await setValue(folder, name, environment, ...rest);
    if (result?.saved) await vault.valuesFor(folder, [], environment, false).then(({ id }) => changed(id, name, environment), () => {});
    return result;
  };
  vault.remove = async (id, name, environment) => {
    const result = await remove(id, name, environment);
    await changed(id, name, environment);
    return result;
  };
  return vault;
}

/** Board window only: `handle` is pairing-ipc's checked handler. */
function registerWorkerKeep(handle, keeper) {
  handle("worker-keep:list", (worker) => keeper.list(String(worker)));
  handle("worker-keep:keep", (req) => keeper.keep(req && typeof req === "object" ? req : {}));
  handle("worker-keep:stop", (req) => keeper.stop(req && typeof req === "object" ? req : {}));
  handle("worker-keep:wipe", (worker) => keeper.wipe(String(worker)));
}

module.exports = { createWorkerKeep, watchVault, registerWorkerKeep };
