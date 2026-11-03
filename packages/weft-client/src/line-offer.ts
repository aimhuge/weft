// A session line's opening offer, sealed by the board itself (docs/architecture/project-hosts.md#the-session-line-h6-as-built):
// weft.zip and the phone have no Mac server to seal for them, so they read the worker's published key with their own
// session, seal the offer to it here (seal.ts, byte for byte as lib/worker-board.ts openWorkerLine) and insert the `line`
// row themselves. The database lets only the worker's owner insert it (private.owns_device), and only in this shape
// (supabase/migrations/20261103150000_line_row_shape.sql). The line itself grants nothing: each verb over it passes the
// worker's `host` checks (remoteRefusal, CardRules), and a widening still needs its own signed approval.
import { sealTo, type Sealed, type SealCrypto } from "./seal";

export const LINE_CHANNELS = { host: "host", events: "events", control: "line", terminal: "terminal" } as const;
// The sealed offer's purpose: a screen offer (rtc-offer) can't be replayed as a line, or the other way round.
export const LINE_PURPOSE = "rtc-line";
export const lineTopic = (token: string) => `worker-line:${token}`;

// A STUN or TURN server, as RTCPeerConnection and werift take it.
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// What the board seals to the worker's key: its offer, the one-time key the answer comes back under, the topic it
// listens on, and the ICE servers both sides use.
export interface LineOffer {
  sdp: string;
  key: string;
  topic: string;
  ice: IceServer[];
}

// The `line` row, exactly: no card, no folder, nothing in the payload but the sealed offer (the sender's client hint
// rides beside it, as on every row).
export interface LineRow {
  org_id: string;
  kind: "line";
  target_device: string;
  folder: "";
  payload: { sealed: Sealed };
}

const WORKER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lineRow(orgId: string, workerId: string, sealed: Sealed): LineRow {
  if (!WORKER_ID.test(workerId)) throw new Error("That isn't a worker.");
  return { org_id: orgId, kind: "line", target_device: `worker:${workerId}`, folder: "", payload: { sealed } };
}

// The offer's plaintext, its fields in the server's order, so a sealed offer reads the same whoever sealed it.
export const linePlaintext = ({ sdp, key, topic, ice }: LineOffer) => JSON.stringify({ sdp, key, topic, ice });

export interface LineOpenerDeps {
  crypto: SealCrypto;
  orgId: string;
  // The worker's published X25519 key (cloud_workers.public_key), read with the signed-in session; null when it has none.
  publicKeyOf: (workerId: string) => Promise<string | null>;
  // Inserts the row under the signed-in session; its id, or why the database refused it.
  insert: (row: LineRow) => Promise<{ id: string } | string>;
}

// The `offer` a session line takes (lib/session-line.ts LineDeps.offer, openLine below): seals and sends the `line` row.
// A throw stops the line's retries, as a refusal from the Mac's server does.
export function lineOpener({ crypto, orgId, publicKeyOf, insert }: LineOpenerDeps) {
  return async (workerId: string, offer: LineOffer): Promise<{ commandId: string }> => {
    const key = await publicKeyOf(workerId);
    if (!key) throw new Error("That worker hasn't published its key yet.");
    const row = lineRow(orgId, workerId, await sealTo(crypto, key, linePlaintext(offer), LINE_PURPOSE));
    const sent = await insert(row);
    if (typeof sent === "string") throw new Error(`Couldn't reach your worker: ${sent}`);
    return { commandId: sent.id };
  };
}
