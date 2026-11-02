// Main's copy of lib/connector-messages.ts (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust): what
// this Mac signs with its approval key (electron/desktop-signer.cjs) for weft.zip's connectors, after Touch ID. Held
// to the TypeScript byte for byte by electron/connector-sign.test.ts, since weft.zip checks these signatures against
// the TypeScript's messages.

const grantMessage = (g) =>
  JSON.stringify(["weft-connector-grant-v1", g.userId, g.workerId, g.connector, g.settings.scope, g.settings.approval, g.settings.lifetime, [...g.settings.asks].sort(), [...g.repos].sort(), g.nonce, g.issuedAt, g.prevEpoch]);

const allowMessage = (a) => JSON.stringify(["weft-connector-allow-v1", a.userId, a.grantId, a.kind, a.subject, a.nonce, a.issuedAt]);

const workerMessage = (w) => JSON.stringify(["weft-connector-worker-v1", w.userId, w.workerId, w.signKey, w.boxKey]);

const startMessage = (s) => JSON.stringify(["weft-connector-start-v1", s.userId, s.workerId, s.cardId, s.folder, s.repo, s.nonce, s.issuedAt]);

const signerMessage = (s) => JSON.stringify(["weft-connector-signer-v1", s.userId, s.key, s.name, s.issuedAt]);

const endorseMessage = (e) => JSON.stringify(["weft-connector-endorse-v1", e.userId, e.key, e.by, e.issuedAt]);

module.exports = { grantMessage, allowMessage, workerMessage, startMessage, signerMessage, endorseMessage };
