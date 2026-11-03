// A pasted or dropped file, as the machine that saved it answers the upload (the app's lib/client-api.ts uploads it,
// lib/media.ts reads a message's refs to one).
export type MediaKind = "image" | "video" | "audio" | "file";

export interface UploadedAttachment {
  name: string;
  path: string;
  url: string;
  kind: MediaKind;
  bytes: number;
}
