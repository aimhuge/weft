// Main's copy of lib/worker-keep-wire.ts (docs/architecture/secrets.md#kept-on-a-worker): the message this Mac signs for
// a `vault_keep` and the purpose each kept value is sealed for. electron/worker-keep-wire.test.ts holds the two together.
const { canonical } = require("./widen-sign.cjs");

const KEEP_KIND = "vault_keep";
const KEEP_V = "weft-vault-keep-v1";
// Production values never stay on a worker (lib/worker-keep-wire.ts KEEP_ENVIRONMENTS).
const KEEP_ENVIRONMENTS = ["development", "preview"];

/** @param {{ worker: string, seq: number, issuedAt: number, op: string, repo?: string, environment?: string, entries?: unknown[], names?: string[] }} k */
const keepMessage = (k) =>
  canonical({ v: KEEP_V, worker: k.worker, seq: k.seq, issuedAt: k.issuedAt, op: k.op, repo: k.repo ?? null, environment: k.environment ?? null, entries: k.entries ?? null, names: k.names ?? null });

/** @param {string} worker @param {string} repo @param {string} environment @param {string} name @param {number} version */
const keptPurpose = (worker, repo, environment, name, version) => `vault-keep:${worker}:${repo}:${environment}:${name}:${version}`;

module.exports = { KEEP_KIND, KEEP_V, KEEP_ENVIRONMENTS, keepMessage, keptPurpose };
