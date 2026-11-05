// A file pasted on weft.zip into a card this Mac runs (lib/web-upload.ts): the command lists it as { name, sha, mime }
// and the bytes are in the workspace's blobs. This brings each down through the account's own session (a member reads
// the workspace's blobs), checks it and saves it in this Mac's attachments folder, and points the text at the copy, the
// same receiveAttachments a worker runs for a file a Mac sent it (lib/attachment-transfer.ts). The worker reads through
// app/api/worker-blob because it has a key and no session; this Mac has the session, so it reads as you. A paired
// browser seals what it sends a sealed card (lib/blob-seal.ts); this Mac opens it with the workspace key main holds.
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachmentsOf, receiveAttachments } from "./attachment-transfer";
import { openBlob, sealedVersion } from "./blob-seal";
import { readBlob } from "./blob-read";
import { syncOrgId } from "./cloud-sync";
import { sodium } from "./sodium";
import { macKeyring } from "./sync-seal-upload";
import { DATA_DIR } from "./store";

export interface MacReceiveDeps {
  // Where this Mac's composer saves what you paste (lib/attachments.ts ATTACHMENTS_DIR, without its image tools).
  dir?: () => string;
  read?: typeof readBlob;
  keyring?: typeof macKeyring;
}

// The blob's plain bytes; a sealed one opened with main's key. Throws, saying so, when it's sealed and won't open here.
async function plainBytes(raw: Uint8Array, org: string, sha: string, keyring: typeof macKeyring): Promise<Buffer> {
  const version = sealedVersion(raw);
  if (version === null) return Buffer.from(raw);
  const opened = await openBlob(await sodium(), raw, await keyring(org), org, sha);
  if (!opened) throw new Error(`A file came sealed with workspace key v${version}, which this Mac doesn't hold. Pair it in Settings → Sync, or send the file again.`);
  return Buffer.from(opened.bytes);
}

export function macReceive(client: SupabaseClient, uid: string, { dir = () => path.join(DATA_DIR, "attachments"), read = readBlob, keyring = macKeyring }: MacReceiveDeps = {}) {
  // The files are in the blobs of the workspace the command came through: a team's, for a project it linked.
  return async (text: string, payload: unknown, orgId?: string): Promise<string> => {
    const refs = attachmentsOf(payload);
    if (!refs) return text;
    const org = orgId ?? (await syncOrgId(client, uid));
    if (!org) throw new Error("This Mac doesn't sync to a workspace, so it can't bring the files over.");
    return receiveAttachments(text, refs, dir(), async (sha) => {
      const got = await read(client, org, sha);
      return got ? plainBytes(new Uint8Array(got.bytes), org, sha, keyring) : null;
    });
  };
}
