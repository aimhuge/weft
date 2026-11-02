// A file pasted on weft.zip into a card this Mac runs (lib/web-upload.ts): the command lists it as { name, sha, mime }
// and the bytes are in the workspace's blobs. This brings each down through the account's own session (a member reads
// the workspace's blobs), checks it and saves it in this Mac's attachments folder, and points the text at the copy, the
// same receiveAttachments a worker runs for a file a Mac sent it (lib/attachment-transfer.ts). The worker reads through
// app/api/worker-blob because it has a key and no session; this Mac has the session, so it reads as you.
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachmentsOf, receiveAttachments } from "./attachment-transfer";
import { readBlob } from "./blob-read";
import { syncOrgId } from "./cloud-sync";
import { DATA_DIR } from "./store";

export interface MacReceiveDeps {
  // Where this Mac's composer saves what you paste (lib/attachments.ts ATTACHMENTS_DIR, without its image tools).
  dir?: () => string;
  read?: typeof readBlob;
}

export function macReceive(client: SupabaseClient, uid: string, { dir = () => path.join(DATA_DIR, "attachments"), read = readBlob }: MacReceiveDeps = {}) {
  return async (text: string, payload: unknown): Promise<string> => {
    const refs = attachmentsOf(payload);
    if (!refs) return text;
    const org = await syncOrgId(client, uid);
    if (!org) throw new Error("This Mac doesn't sync to a workspace, so it can't bring the files over.");
    return receiveAttachments(text, refs, dir(), async (sha) => {
      const got = await read(client, org, sha);
      return got ? Buffer.from(got.bytes) : null;
    });
  };
}
