// A page or picture uploaded by content hash (lib/cloud-sync-types.ts re-exports these): what a thread item or a
// card's page holds in place of a local path once it has left the machine that made it.
export const BLOB_REF_PREFIX = "blob:sha256:";
export type BlobRef = `blob:sha256:${string}`;
