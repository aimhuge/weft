// Which card a mint is for, and whether it's still yours to serve (docs/architecture/connectors.md#who-may-say-yes-the-chain-of-trust).
// A card gets tokens only through its one start command: the desktop board's card.create, signed by a Mac of yours
// (electron/connector-start.cjs) over the worker, card, folder, repo and a fresh nonce, sent within minutes of signing.
// The first mint pins the card to that start (connector_cards), once per signature; every later mint re-checks the
// signer is still trusted, and a card seen Done or deleted has its pin closed for good, so neither it nor a replay of
// its start mints again (and the worker never re-creates a card id it has had, lib/host-api/card-create.ts).
import "server-only";
import { createHash } from "node:crypto";
import type { ConnectorDb, PinnedCard, StartRow, WorkerRow } from "./connector-db";
import { MintError } from "./connector-tokens";
import { isTrusted, startSigner } from "./connector-trust";

// A start's signature counts only if its command row was made within this long of signing.
export const START_FRESH_MS = 5 * 60_000;

// The command that starts a card the connector serves: the desktop board's card.create, whose card id is in the args you
// wrote. A run or new_card gets its card id from the worker's report, so it can't carry a signed start; a reply or a verb
// over the H6 line makes no such row; and a card another worker sent (worker_new_card stamps it fromWorker) isn't yours.
const startsCard = (r: StartRow) => {
  const p = (r.payload ?? {}) as { verb?: unknown; fromWorker?: unknown };
  return !p.fromWorker && r.kind === "host" && p.verb === "card.create";
};

// The repo a start names: a git URL (https://github.com/<owner>/<name>.git) or the owner/name the desktop board put on a
// card.create from the project's own origin (lib/worker-folder-repo.ts). Null for anything else.
export function repoOfUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url);
  return m?.[1] ?? null;
}

type SignedStart = { key: string; sig: string; issuedAt: number; nonce: string };

// The one owner-created card.create for the card, its repo and its checked start, or a refusal.
async function startOf(db: ConnectorDb, worker: WorkerRow, cardId: string, now: number) {
  const rows = (await db.starts(worker.id, cardId, worker.owner_user)).filter((r) => r.created_by === worker.owner_user);
  if (rows.length > 1) throw new MintError(403, "That card has more than one start, so Weft can't tell which is yours. Start a new card for this project.");
  const start = rows.find(startsCard);
  if (!start) throw new MintError(403, "Connectors only work in a card you started on this worker from the board. Start a new card for this project.");
  const payload = start.payload as { repo?: unknown; start?: unknown };
  const repo = repoOfUrl(payload.repo);
  if (!repo) throw new MintError(403, "That card's start didn't name its GitHub repo. Start it from the desktop board, which reads the project's origin.");
  const signer = await startSigner(db, { userId: worker.owner_user, workerId: worker.id, cardId, folder: start.folder, repo, start: payload.start }, now);
  if (typeof signer === "string") throw new MintError(403, signer);
  const signed = payload.start as SignedStart;
  const sent = start.created_at ? Date.parse(start.created_at) : Number.NaN;
  if (!(Math.abs(sent - signed.issuedAt) <= START_FRESH_MS)) throw new MintError(403, "That card's start was signed at another time than it was sent. Start a new card for this project.");
  return { folder: start.folder, repo, signed, signerId: signer.id };
}

// The card's project: its pin, re-checked, or its start, checked and pinned now (start commands expire after a day).
export async function cardProject(db: ConnectorDb, worker: WorkerRow, cardId: string, now: number): Promise<PinnedCard> {
  const pinned = await db.pinnedCard(worker.id, cardId);
  if (pinned) {
    if (pinned.user_id !== worker.owner_user) throw new MintError(403, "That card isn't one you started.");
    if (pinned.closed_at) throw new MintError(403, "That card is Done or deleted, so it gets no token.");
    const signer = pinned.signer_id ? await db.signerById(pinned.signer_id) : null;
    if (signer?.user_id !== worker.owner_user || !isTrusted(signer, now)) throw new MintError(403, "That card was started from a Mac that isn't trusted now.");
    return pinned;
  }
  const { folder, repo, signed, signerId } = await startOf(db, worker, cardId, now);
  const card: PinnedCard = { user_id: worker.owner_user, folder, repo, signer_id: signerId, start_sig: createHash("sha256").update(signed.sig).digest("hex") };
  if (await db.pinCard(worker.id, cardId, card)) return card;
  // Pinned beside this mint by another for the same start, or the signature already pinned another card (a replay).
  const again = await db.pinnedCard(worker.id, cardId);
  if (again?.start_sig !== card.start_sig) throw new MintError(403, "That card's start was used for another card already.");
  return again;
}

// Refuses a card that's Done or deleted on this worker, and closes its pin so it never mints again.
export async function openCard(db: ConnectorDb, worker: WorkerRow, cardId: string, now: number): Promise<void> {
  const state = await db.cardState(worker.org_id, worker.id, cardId);
  if (!state?.deleted && state?.column !== "done") return;
  await db.closePin(worker.id, cardId, new Date(now).toISOString());
  throw new MintError(403, "That card is Done or deleted, so it gets no token.");
}
