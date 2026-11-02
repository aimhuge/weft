// What a pasted file that travels is (lib/attachment-transfer.ts sends and receives it): the ref a command carries, the
// types and sizes that may go, and the names a message's text pastes. Plain data, no Node, so weft.zip's composer
// (lib/web-upload.ts) builds the same refs in the browser that a Mac builds for a worker.
import { MEDIA_REF, attachmentName } from "./media";

export interface AttachmentRef {
  name: string;
  sha: string;
  mime: string;
}

// Images and PDFs only: what a thread reads as a picture or a document. A screen recording stays on the Mac it was
// pasted on, and the sender says so rather than send a path the other side can't open.
export const TRAVEL_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

export const MAX_TRAVEL_BYTES = 25 * 1024 ** 2;
// More than a message would sensibly paste; a row can't make the host fetch without end.
export const MAX_TRAVEL_FILES = 20;

// The attachment names a message's text pastes, once each, in order.
export function pastedNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(MEDIA_REF)) {
    const name = attachmentName((m[2] ?? m[3]) as string);
    if (name) names.add(name);
  }
  return [...names];
}
