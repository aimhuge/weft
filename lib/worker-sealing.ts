// A Weft Worker seals and opens like a Mac's outbox (docs/architecture/mobile-security.md#step-b-the-worker-seals-and-opens),
// with the keys its Mac granted it (lib/worker-keyring.ts): its publisher's rows and the files they name go up sealed
// through the same makeSealer (lib/sync-seal-upload.ts), a page it opens in the pane goes up sealed for its card, and a
// file pasted into one of its cards comes down through openBlob. A card with a share link stays plain, as on a Mac.
import { openBlob, sealedVersion } from "./blob-seal";
import type { BlobSeal } from "./cloud-sync-types";
import type { Sodium } from "./sodium";
import { makeSealer, type Sealer } from "./sync-seal-upload";
import type { WorkerKeyring } from "./worker-keyring";
import { HELD } from "./worker-seal-rows";

export interface WorkerSealing {
  // The sealer for this flush; null to publish plain; "hold" to keep rows back.
  sealer: () => Sealer | null | "hold";
  // How a file a card names goes up: sealed, or null for plain. Throws while holding.
  blobSeal: (cardId: string | undefined) => BlobSeal | null;
}

export function workerSealing(ring: Pick<WorkerKeyring, "state">, s: Sodium, isShared: (cardId: string) => boolean): WorkerSealing {
  const sealer = () => {
    const state = ring.state();
    if (state === "hold") return "hold";
    return state === "plain" ? null : makeSealer(s, state.key, isShared);
  };
  return {
    sealer,
    blobSeal(cardId) {
      const seal = sealer();
      if (seal === "hold") throw new Error(`Not uploaded: ${HELD}.`);
      return seal ? seal.blob(cardId ?? "") : null;
    },
  };
}

// The attachment reader with sealed files opened: a plain one passes through, a sealed one that opens comes back plain
// (and only when it hashes to its sha), and one that won't open is null, logged with the version it needs.
export function openingReader(read: (sha: string) => Promise<Buffer | null>, ring: Pick<WorkerKeyring, "ring">, orgId: string, s: () => Promise<Sodium>, log: (msg: string) => void) {
  return async (sha: string): Promise<Buffer | null> => {
    const bytes = await read(sha);
    if (!bytes) return null;
    const version = sealedVersion(bytes);
    if (version === null) return bytes;
    const opened = await openBlob(await s(), bytes, ring.ring(), orgId, sha);
    if (opened) return Buffer.from(opened.bytes);
    log(`Weft Worker: a file sent to it is sealed with workspace key v${version}, which this worker doesn't hold (Settings → Devices → the worker → Seal…)`);
    return null;
  };
}

