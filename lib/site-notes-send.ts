import type { UploadResult } from "./site-notes-remote";
import type { OutboxItem } from "./site-notes-store";

// Sending the outbox to everyone, after the user read it in Settings → Security (docs/architecture/site-notes.md#consent).
// A note weft.zip refuses is dropped with its reason; one that couldn't go (offline, signed out) waits for next time.

export type SendDeps = {
  take: (ids?: string[]) => OutboxItem[];
  requeue: (item: OutboxItem) => void;
  upload: (u: { host: string; path: string; body: string; scope: "public" }) => Promise<UploadResult>;
};

export type SendResult = { id: string; sent: boolean; error?: string };

const RETRY = new Set(["offline", "signed-out", "too-many", "unconfigured"]);

export async function sendOutbox(ids: string[] | undefined, deps: SendDeps): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const item of deps.take(ids)) {
    const r = await deps.upload({ host: item.host, path: item.path, body: item.body, scope: "public" });
    if (r.ok) {
      results.push({ id: item.id, sent: true });
      continue;
    }
    if (RETRY.has(r.error)) deps.requeue(item);
    results.push({ id: item.id, sent: false, error: r.error });
  }
  return results;
}
