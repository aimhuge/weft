// How a WebRTC connection to a worker proves itself (docs/architecture/weft-worker.md#the-fast-path). The offer is sealed
// to the worker's public key; the answer comes back under a one-time key that was inside it. So only the real worker can
// answer, and each side's DTLS fingerprint arrives protected, which is what keeps anyone from sitting in the middle. Web
// Crypto, so the worker and the board run the same code.
import type { SealedAnswer } from "@weft/client";

export const RTC_PURPOSE = "rtc-offer";
// Finds each side's public address so the two can connect directly; it never sees the traffic (@weft/client's).
export { STUN, type SealedAnswer } from "@weft/client";
// The Broadcast event the answer arrives on, beside the frames.
export const ANSWER_EVENT = "answer";

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const bytesOf = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const aes = (key: string, use: "encrypt" | "decrypt") => crypto.subtle.importKey("raw", bytesOf(key), "AES-GCM", false, [use]);

export const newAnswerKey = () => b64(crypto.getRandomValues(new Uint8Array(32)));

export async function sealAnswer(key: string, sdp: string): Promise<SealedAnswer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(key, "encrypt"), new TextEncoder().encode(sdp));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

// Throws when it wasn't made with this key, so a forged answer never reaches the peer connection.
export async function openAnswer(key: string, sealed: SealedAnswer): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesOf(sealed.iv) }, await aes(key, "decrypt"), bytesOf(sealed.ct));
  return new TextDecoder().decode(plain);
}

// What the input channel carries: a live gesture in fractions of the screen, or a key by its HID usage.
export type LiveEvent = { t: "down" | "move" | "up"; x: number; y: number } | { t: "key"; code: number; down: boolean };

export function liveEvent(raw: string): LiveEvent | null {
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (p.t === "key") return typeof p.code === "number" && Number.isInteger(p.code) && typeof p.down === "boolean" ? { t: "key", code: p.code, down: p.down } : null;
  const fraction = (v: unknown) => typeof v === "number" && v >= 0 && v <= 1;
  if ((p.t === "down" || p.t === "move" || p.t === "up") && fraction(p.x) && fraction(p.y)) return { t: p.t, x: p.x as number, y: p.y as number };
  return null;
}

// How sharp and smooth the video is, picked in the pane (components/web-board/WorkerScreen.tsx) and carried in the
// sealed offer; lib/idb-companion.ts turns it into the encoder's fps, scale and bitrate. A new pick is a new offer.
export const SCREEN_QUALITIES = ["low", "medium", "high"] as const;
export type ScreenQuality = (typeof SCREEN_QUALITIES)[number];
export const DEFAULT_QUALITY: ScreenQuality = "medium";

export const screenQuality = (v: unknown): ScreenQuality => SCREEN_QUALITIES.find((q) => q === v) ?? DEFAULT_QUALITY;
