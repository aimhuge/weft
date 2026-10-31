// Server start (lib/copilot.ts prewarm): the outbox on the account's client, with a blob store made the first
// time a flush needs one, the inbox that runs cards started on the weft.zip board, and the timer that keeps shared
// mini apps' link previews current (lib/app-preview-refresh.ts). Until a folder is in
// settings `syncFolders` the listener drops every event and the inbox holds nothing open, so this costs nothing
// on a board that doesn't sync (docs/architecture/cloud-sync.md).
import { accountClient } from "./account";
import { startPreviewRefresh } from "./app-preview-refresh";
import { createBlobStore, type BlobStoreBundle } from "./blob-store";
import type { BlobStore } from "./cloud-sync-types";
import { startCloudInbox } from "./cloud-inbox";
import { startCloudSync } from "./cloud-sync";
import { startSyncRepos } from "./cloud-sync-repos";

export function startAccountCloudSync(): () => void {
  let store: BlobStoreBundle | null = null;
  const blobs = (): BlobStoreBundle => (store ??= createBlobStore({ client: accountClient() }));
  const lazy: BlobStore = {
    refFor: (localPath) => blobs().refFor(localPath),
    upload: (localPath, orgId) => blobs().upload(localPath, orgId),
    uploadPage: (localPath, orgId) => blobs().uploadPage(localPath, orgId),
    rewriteItem: (item, orgId) => blobs().rewriteItem(item, orgId),
  };
  const stopSync = startCloudSync({ blobs: lazy });
  const stopInbox = startCloudInbox();
  const stopPreviews = startPreviewRefresh();
  // Turn sync on for projects you sync from another Mac (lib/cloud-sync-repos.ts).
  const stopRepos = startSyncRepos();
  return () => {
    stopRepos();
    stopPreviews();
    stopInbox();
    stopSync();
  };
}
