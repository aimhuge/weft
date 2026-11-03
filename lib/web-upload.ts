// A file pasted or dropped in weft.zip's composer (docs/architecture/project-hosts.md, H3b's follow-up): there is no
// attachments folder in a browser tab, so the file goes straight to the workspace's blob store as the visitor
// (<org>/<sha>, the weft-blobs insert policy), and the composer pastes a path the text can name it by. When the message
// goes, the row lists the files its text pastes as { name, sha, mime } (lib/attachment-refs.ts), the same refs a Mac
// sends a worker; the machine that runs the card brings each down into its own attachments folder and points the text
// at it before the turn starts (lib/attachment-transfer.ts receiveAttachments: a worker through app/api/worker-blob,
// a Mac through its own session, lib/cloud-inbox-cards.ts).
//
// A browser that holds a workspace key (paired, lib/web-sync-key.ts) holds each file until its message goes, then puts
// it sealed when the card it goes to came sealed (its host holds that key), plain otherwise (lib/blob-seal.ts). One
// with no key puts at once, plain, as before.
import { MAX_TRAVEL_BYTES, MAX_TRAVEL_FILES, TRAVEL_MIME, pastedNames, type AttachmentRef } from "./attachment-refs";
import type { NewCommand } from "./cloud-commands";
import type { UploadedAttachment } from "./client-api";
import type { BlobSeal } from "./cloud-sync-types";
import { extensionOf, mediaKind } from "./media";

export interface WebUploadInput {
  orgId: string;
  // Puts the bytes in the blob store under the workspace and sha; resolves to null once they're there (or were
  // already), or to why they couldn't go.
  put: (sha: string, bytes: ArrayBuffer | Uint8Array, mime: string) => Promise<string | null>;
  // Whether this browser could seal (it holds a key): then a file waits for its message, to go up sealed or not.
  holds?: () => boolean;
  // sha256 of the bytes, as hex; the browser's own SubtleCrypto by default.
  digest?: (bytes: ArrayBuffer) => Promise<string>;
  // A URL the composer can show the file from while it's being written; an object URL by default.
  preview?: (file: Blob) => string;
}

export interface WebUploads {
  upload: (file: Blob, name: string, onProgress?: (fraction: number) => void) => Promise<UploadedAttachment>;
  // The refs for the files a message's text pastes that this page uploaded, in order.
  refsFor: (text: string) => AttachmentRef[];
  // Puts the held files among `refs`, sealed with `seal` or plain; throws why one couldn't go. One already up stays.
  send: (refs: AttachmentRef[], seal: BlobSeal | null) => Promise<void>;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const EXT_BY_MIME = Object.fromEntries(Object.entries(TRAVEL_MIME).map(([ext, mime]) => [mime, ext]));

// The file's name as an attachment: "<slug>-<sha8>.<ext>", which lib/media.ts ATTACHMENT_NAME accepts, so the host
// takes it. The same bytes under the same name always make the same name. Null for a type that doesn't travel.
export function travelName(original: string, type: string, sha: string): string | null {
  const ext = TRAVEL_MIME[extensionOf(original)] ? extensionOf(original) : EXT_BY_MIME[type];
  if (!ext) return null;
  const base = original.replace(/\.[^.]*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return `${base || "paste"}-${sha.slice(0, 8)}.${ext}`;
}

export function webUploads({ orgId, put, holds = () => false, digest = sha256, preview = (file) => URL.createObjectURL(file) }: WebUploadInput): WebUploads {
  const uploaded = new Map<string, AttachmentRef>();
  // Files waiting for their message, by sha.
  const held = new Map<string, ArrayBuffer>();
  const putOne = async (ref: AttachmentRef, bytes: ArrayBuffer | Uint8Array, name: string) => {
    const problem = await put(ref.sha, bytes, ref.mime);
    if (problem) throw new Error(`Couldn't upload ${name}: ${problem}`);
  };
  return {
    async upload(file, name, onProgress) {
      if (file.size > MAX_TRAVEL_BYTES) throw new Error(`${name} is over ${MAX_TRAVEL_BYTES / 1024 ** 2} MB, too big to send from here.`);
      const bytes = await file.arrayBuffer();
      const sha = await digest(bytes);
      const saved = travelName(name, file.type, sha);
      if (!saved) throw new Error(`Only images and PDFs can be sent from weft.zip, so ${name} can't go.`);
      const ref: AttachmentRef = { name: saved, sha, mime: TRAVEL_MIME[extensionOf(saved)] as string };
      if (holds()) held.set(sha, bytes);
      else await putOne(ref, bytes, name);
      onProgress?.(1);
      uploaded.set(saved, ref);
      return { name: saved, path: `/attachments/${saved}`, url: preview(file), kind: mediaKind(saved), bytes: file.size };
    },
    refsFor(text) {
      const refs = pastedNames(text).flatMap((n) => uploaded.get(n) ?? []);
      if (refs.length > MAX_TRAVEL_FILES) throw new Error(`A message takes up to ${MAX_TRAVEL_FILES} files.`);
      return refs;
    },
    async send(refs, seal) {
      for (const ref of refs) {
        const bytes = held.get(ref.sha);
        if (!bytes) continue;
        await putOne(ref, seal ? seal(orgId, ref.sha, new Uint8Array(bytes)) : bytes, ref.name);
        held.delete(ref.sha);
      }
    },
  };
}

// The typed text a row carries: a reply's text, a new card's prompt, a host verb's text or message.
function rowText(row: NewCommand): string {
  const p = row.payload as { text?: unknown; prompt?: unknown; args?: { text?: unknown; message?: unknown } };
  const text = p.text ?? p.prompt ?? p.args?.text ?? p.args?.message;
  return typeof text === "string" ? text : "";
}

// The card a row is for, when it names one: a reply's or an answer's cardId, a host verb's args.id.
export function rowCard(row: NewCommand): string | null {
  const p = row.payload as { cardId?: unknown; args?: { id?: unknown } };
  const id = p.cardId ?? p.args?.id;
  return typeof id === "string" && id ? id : null;
}

// The row with its files listed and up: sealed for a card whose host holds the key (`sealFor`), else plain.
export async function withAttachments(row: NewCommand, uploads: Pick<WebUploads, "refsFor" | "send">, sealFor: (cardId: string | null) => BlobSeal | null): Promise<NewCommand> {
  const next = withAttachmentRefs(row, uploads);
  const refs = (next.payload as { attachments?: AttachmentRef[] }).attachments;
  if (refs?.length) await uploads.send(refs, sealFor(rowCard(row)));
  return next;
}

// The row with the files its text pastes listed on it, or as it was when it pastes none of this page's.
export function withAttachmentRefs(row: NewCommand, uploads: Pick<WebUploads, "refsFor">): NewCommand {
  const attachments = uploads.refsFor(rowText(row));
  // The payload types don't name `attachments`: it rides beside any kind's fields, as a Mac's do for a worker.
  const payload: unknown = { ...row.payload, attachments };
  return attachments.length ? { ...row, payload: payload as NewCommand["payload"] } : row;
}
