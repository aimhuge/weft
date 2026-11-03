"use client";

// weft.zip's session lines (docs/architecture/project-hosts.md#the-session-line-h6-as-built): the desktop's own line
// (lib/session-line.ts, held through lib/session-lines.ts), but the browser seals the offer itself, since a tab has no
// Mac server to do it. It reads the worker's published key and inserts the `line` row with the visitor's own session
// (@weft/client lineOpener), so RLS lets only the worker's owner open one (private.owns_device), in exactly the row's
// shape (supabase/migrations/20261103120000_line_row_shape.sql). The answer comes back on the board's own Broadcast
// topic as on the desktop (lib/line-answer.ts). No TURN here yet: a tab can't mint Cloudflare credentials (/api/rtc-ice
// is this Mac's), so a line forms where STUN gets through and the board stays on the relay where it doesn't.
//
// What a line from here can do is what a row from here can do: each verb passes the worker's `host` checks
// (remoteRefusal, CardRules), the board never sends a widening down it (lib/cloud-host-acts.ts signs those on
// sign.weft.zip and sends them as rows), and it never opens the terminal channel, which needs the Mac's Touch ID key.
import type { SupabaseClient } from "@supabase/supabase-js";
import { lineOpener, ownTimeZone, STUN, withClientHint, type ClientHint, type LineOffer, type LineRow, type SealCrypto, type SubtleLike } from "@weft/client";
import { lineToken, listenForAnswer } from "./line-answer";
import { createSessionLine, type LineDeps } from "./session-line";
import type { MakeLine } from "./session-lines";
import { sodium } from "./sodium";

// Says it's weft.zip, with this browser's time zone, for the thread's <weft-env> block: a hint, never a check.
export const webClientHint = (): ClientHint => {
  const tz = ownTimeZone();
  return { app: "web", ...(tz && { tz }) };
};

// The browser's libsodium (X25519) and Web Crypto (HKDF, AES-GCM), what @weft/client seals with.
export async function webSealCrypto(): Promise<SealCrypto> {
  return { sodium: await sodium(), subtle: globalThis.crypto.subtle as unknown as SubtleLike };
}

type Db = Pick<SupabaseClient, "from">;

async function publicKeyOf(client: Db, workerId: string): Promise<string | null> {
  const { data } = await client.from("cloud_workers").select("public_key").eq("id", workerId).maybeSingle<{ public_key: string | null }>();
  return data?.public_key ?? null;
}

async function insertLine(client: Db, row: LineRow): Promise<{ id: string } | string> {
  const { data, error } = await client.from("cloud_commands").insert(withClientHint(row, webClientHint())).select("id").single<{ id: string }>();
  return error ? error.message : data;
}

// The line's `offer`: sealed here to the worker's key and inserted as the visitor.
export function webLineOffer(client: Db, orgId: string, crypto: () => Promise<SealCrypto> = webSealCrypto) {
  return async (workerId: string, offer: LineOffer) =>
    lineOpener({ crypto: await crypto(), orgId, publicKeyOf: (id) => publicKeyOf(client, id), insert: (row) => insertLine(client, row) })(workerId, offer);
}

// How weft.zip makes a worker's line, for lib/session-lines.ts retainLine / useSessionLine.
export function webLines(client: Db, orgId: string, over: Partial<LineDeps> = {}): MakeLine {
  const deps: LineDeps = {
    peer: (servers) => new RTCPeerConnection({ iceServers: servers }),
    ice: () => Promise.resolve([{ urls: STUN }]),
    offer: webLineOffer(client, orgId),
    listen: listenForAnswer,
    token: lineToken,
    ...over,
  };
  return (workerId) => createSessionLine(workerId, deps);
}
