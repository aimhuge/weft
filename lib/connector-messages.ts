// What a Mac signs for weft.zip's connectors (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust), with
// its desktop approval key (electron/desktop-signer.cjs: Ed25519, only Electron main holds it, used after Touch ID).
// weft.zip checks each signature when the row is written and the mint checks it again before every token, so a row
// written any other way (a stolen session, a thread with the account's refresh token) mints nothing.
// Pure: no I/O, no Node, safe in client code. Main's copy is electron/connector-sign.cjs, held to these by a test.
import type { GrantSettings } from "./connector-grant";

// A grant: your yes for one worker to use one connector, with its settings. prevEpoch is the grant's epoch the change
// replaces (0 for a new one), so a signed change applies to that grant once and never re-creates one turned off.
export interface GrantStatement {
  userId: string;
  workerId: string;
  connector: string;
  settings: GrantSettings;
  nonce: string;
  issuedAt: number;
  prevEpoch: number;
}

export const grantMessage = (g: GrantStatement) =>
  JSON.stringify(["weft-connector-grant-v1", g.userId, g.workerId, g.connector, g.settings.scope, g.settings.approval, g.settings.lifetime, [...g.settings.asks].sort(), g.nonce, g.issuedAt, g.prevEpoch]);

// An Allow for one project or card under a per-project or per-card approval.
export interface AllowStatement {
  userId: string;
  grantId: string;
  kind: "project" | "card";
  subject: string;
  nonce: string;
  issuedAt: number;
}

export const allowMessage = (a: AllowStatement) => JSON.stringify(["weft-connector-allow-v1", a.userId, a.grantId, a.kind, a.subject, a.nonce, a.issuedAt]);

// A worker vouched for: the keys this Mac checked and pinned at pairing (electron/host-pairing.cjs), under its Touch ID.
// The mint serves only a worker whose row still has this sign key.
export interface WorkerStatement {
  userId: string;
  workerId: string;
  signKey: string;
  boxKey: string;
}

export const workerMessage = (w: WorkerStatement) => JSON.stringify(["weft-connector-worker-v1", w.userId, w.workerId, w.signKey, w.boxKey]);

// A card started from this Mac's board on a worker, in a folder this Mac knows as that GitHub repo. Only a start signed
// so can mint: a session alone can queue a card.create naming any repo, but can't sign one.
export interface StartStatement {
  userId: string;
  workerId: string;
  cardId: string;
  folder: string;
  repo: string;
  issuedAt: number;
}

export const startMessage = (s: StartStatement) => JSON.stringify(["weft-connector-start-v1", s.userId, s.workerId, s.cardId, s.folder, s.repo, s.issuedAt]);

// A Mac's key offered as a signer, signed by that key (it holds the private half).
export interface SignerStatement {
  userId: string;
  key: string;
  name: string;
  issuedAt: number;
}

export const signerMessage = (s: SignerStatement) => JSON.stringify(["weft-connector-signer-v1", s.userId, s.key, s.name, s.issuedAt]);

// A trusted Mac vouching for another Mac's key, after Touch ID on the trusted one.
export interface EndorseStatement {
  userId: string;
  key: string;
  by: string;
  issuedAt: number;
}

export const endorseMessage = (e: EndorseStatement) => JSON.stringify(["weft-connector-endorse-v1", e.userId, e.key, e.by, e.issuedAt]);

// A Mac's approval key as libsodium writes it: 32 raw bytes in standard base64.
export const SIGNER_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
