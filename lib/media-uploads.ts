// The composer's uploads in flight: each pasted or dropped file's progress, its local preview and
// its error. The store and the "what's still uploading" question live here, so the composer's
// imperative handle (lib/composer-handle.ts) can ask without reaching into the media node's
// component. components/MediaNode.tsx drives the store and draws the progress.

import type { Editor } from "@tiptap/react";

export interface Upload {
  // A local preview, shown while the file uploads.
  preview?: string;
  progress: number;
  error?: string;
}

const uploads = new Map<string, Upload>();
const listeners = new Set<() => void>();

export function setUpload(id: string, patch: Partial<Upload>) {
  uploads.set(id, { progress: 0, ...uploads.get(id), ...patch });
  listeners.forEach((l) => l());
}

// Drops a finished upload from the store, and tells the views that watched it.
export function finishUpload(id: string) {
  const preview = uploads.get(id)?.preview;
  uploads.delete(id);
  listeners.forEach((l) => l());
  return preview;
}

export function uploadOf(id: string): Upload | undefined {
  return uploads.get(id);
}

// Subscribe to the store's changes; returns the unsubscribe. The view calls it on mount.
export function onUploadChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Uploads still running, and ones that failed, in the editor's document.
export function pendingMedia(editor: Editor) {
  let uploading = 0;
  let failed = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "media") return;
    const { uploadId } = node.attrs as { uploadId?: string | null };
    if (!uploadId) return;
    if (uploads.get(uploadId)?.error) failed++;
    else uploading++;
  });
  return { uploading, failed };
}
