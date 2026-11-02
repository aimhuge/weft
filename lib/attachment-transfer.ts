// Attachments that travel (docs/architecture/weft-worker.md#one-engine-two-transports, U2): a reply or a new thread
// sent to a machine that isn't this one carries the files its text pastes. The sender uploads each to the blob store
// and lists it on the command as { name, sha, mime }; the host that runs the card downloads each, checks it, saves it
// in its own attachments folder under the same name and points the text at it before the turn starts. Both halves
// live here so the two can't drift, and so U2's single `action` kind can call them as they are.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ATTACHMENT_NAME, MEDIA_REF, attachmentName, extensionOf } from "./media";

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

const SHA_RE = /^[0-9a-f]{64}$/;
const MB = (bytes: number) => `${Math.round(bytes / 1024 ** 2)} MB`;

// The attachment names a message's text pastes, once each, in order.
export function pastedNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(MEDIA_REF)) {
    const name = attachmentName((m[2] ?? m[3]) as string);
    if (name) names.add(name);
  }
  return [...names];
}

// Sending: every attachment the text names from this machine's attachments folder goes up through `upload` (which
// answers the blob's sha), and comes back as the refs the command carries. A name that isn't in the folder isn't
// this machine's to send (a path a thread quoted, say) and is left out. A file of the wrong type, or too big, stops
// the send with a message the composer shows.
export async function encodeAttachments(text: string, dir: string, upload: (file: string) => Promise<string | null>): Promise<AttachmentRef[]> {
  const names = pastedNames(text);
  if (names.length > MAX_TRAVEL_FILES) throw new Error(`A worker takes up to ${MAX_TRAVEL_FILES} files a message.`);
  const refs: AttachmentRef[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat?.isFile()) continue;
    const mime = TRAVEL_MIME[extensionOf(name)];
    if (!mime) throw new Error(`Only images and PDFs reach a worker, so ${name} can't go. Take it out and send again.`);
    if (stat.size > MAX_TRAVEL_BYTES) throw new Error(`${name} is over ${MB(MAX_TRAVEL_BYTES)}, too big to send to a worker.`);
    const sha = await upload(file);
    if (!sha) throw new Error(`Couldn't upload ${name} for your worker.`);
    refs.push({ name, sha, mime });
  }
  return refs;
}

// The refs a command carries, as the host reads them off the network: only well-formed ones, each name one
// saveAttachment could have made, its type matching its extension. Null when the payload names none.
export function attachmentsOf(payload: unknown): AttachmentRef[] | null {
  const raw = payload && typeof payload === "object" ? (payload as { attachments?: unknown }).attachments : undefined;
  if (!Array.isArray(raw) || !raw.length) return null;
  const refs = raw.slice(0, MAX_TRAVEL_FILES).flatMap((r: unknown): AttachmentRef[] => {
    const { name, sha, mime } = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    if (typeof name !== "string" || typeof sha !== "string" || typeof mime !== "string") return [];
    if (!ATTACHMENT_NAME.test(name) || !SHA_RE.test(sha) || TRAVEL_MIME[extensionOf(name)] !== mime) return [];
    return [{ name, sha, mime }];
  });
  return refs.length ? refs : null;
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

// Saves the bytes under name, unless the same bytes are there already. Written beside it and renamed, so a thread
// never reads half a file.
function save(dir: string, ref: AttachmentRef, bytes: Buffer): string {
  const file = path.join(dir, ref.name);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === ref.sha) return file;
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.part`;
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);
  return file;
}

// Receiving: downloads each ref, holds it to the cap, its sha and its type, saves it in dir and points the text's
// paths for that name at the copy here. A file that can't be brought over fails the whole message, with a reason,
// so the turn never starts on a path it can't open.
export async function receiveAttachments(text: string, refs: AttachmentRef[] | null, dir: string, download: (sha: string) => Promise<Buffer | null>): Promise<string> {
  if (!refs) return text;
  const local = new Map<string, string>();
  for (const ref of refs) {
    const bytes = await download(ref.sha);
    if (!bytes) throw new Error(`Couldn't bring ${ref.name} over from the Mac it was pasted on.`);
    if (bytes.length > MAX_TRAVEL_BYTES) throw new Error(`${ref.name} is over ${MB(MAX_TRAVEL_BYTES)}.`);
    if (sha256(bytes) !== ref.sha) throw new Error(`${ref.name} didn't arrive whole. Send it again.`);
    local.set(ref.name, save(dir, ref, bytes));
  }
  return text.replace(MEDIA_REF, (whole, alt: string, angled?: string, bare?: string) => {
    const name = attachmentName((angled ?? bare) as string);
    const file = name ? local.get(name) : undefined;
    return file ? `![${alt}](${/\s/.test(file) ? `<${file}>` : file})` : whole;
  });
}
