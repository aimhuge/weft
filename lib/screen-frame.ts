// One frame of a worker's live screen for the Realtime fallback (lib/worker-screen.ts): WebP where this box's sharp can
// write it and the boards watching take it (lib/screen-formats.ts), JPEG otherwise. On simulator screenshots at 420 px
// WebP is about half the bytes of JPEG at the same quality, for ~15 ms more encoding. WEFT_SCREEN_FORMAT=jpeg keeps a box
// on JPEG.
import sharp from "sharp";
import type { FrameType } from "./screen-formats";
import { screenshot, type Device } from "./simulator-devices";

// Small enough to send four times a second, big enough to read a label. lib/simulator-watch.ts writes its frames at it too.
export const FRAME_WIDTH = 420;
export const FRAME_QUALITY = 70;

export type { FrameType };

export interface Frame {
  type: FrameType;
  bytes: Buffer;
}

type Formats = Record<string, { output?: { buffer?: boolean } } | undefined>;

// What this box can send: WebP unless it's switched off or libvips was built without it.
export function frameType(env: Record<string, string | undefined> = process.env, formats: Formats = sharp.format as unknown as Formats): FrameType {
  if (env.WEFT_SCREEN_FORMAT === "jpeg") return "jpeg";
  return formats.webp?.output?.buffer ? "webp" : "jpeg";
}

export async function encodeFrame(png: Buffer, type: FrameType, width = FRAME_WIDTH, quality = FRAME_QUALITY): Promise<Frame> {
  const sized = sharp(png).resize({ width, withoutEnlargement: true });
  const bytes = await (type === "webp" ? sized.webp({ quality }) : sized.jpeg({ quality })).toBuffer();
  return { type, bytes };
}

// The device's screen now, small enough to send.
export async function screenFrame(d: Device, type: FrameType): Promise<Frame> {
  return encodeFrame(await screenshot(d), type);
}
