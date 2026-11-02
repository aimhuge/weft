// The session line's wire (docs/architecture/project-hosts.md#routes-the-webrtc-line): one WebRTC peer connection per
// worker host, shared by every card a board shows, with named channels. Both ends read the same parsers, so a message
// one side can't read is dropped, never half-applied.
//
//   host      board → worker  { id, verb, args }        one host-api verb, run as a `host` command is (remoteRefusal)
//             worker → board  { id, ok, result|error }  in order, reliable
//   events    worker → board  { t: "card" | "card_deleted" | "thread" | "thread_cleared", … }   what the relay mirrors
//   line      both ways       ping/pong (the heartbeat and the chip's ms), offer/answer (renegotiation over the line)
//   terminal  board → worker  { t: "open", folder, cols, rows, widen } then input/resize; worker → board opened/data/exit/refused.
//             Only with a signed approval for that folder (lib/host-line-terminal.ts); without one, TERMINAL_REFUSAL.
import type { HostResult } from "./host-command";
import type { ScreenQuality } from "./rtc-signal";
import type { Card, ThreadItem } from "./types";

export const LINE_CHANNELS = { host: "host", events: "events", control: "line", terminal: "terminal" } as const;
// The sealed offer's purpose: a screen offer (RTC_PURPOSE) can't be replayed as a line, or the other way round.
export const LINE_PURPOSE = "rtc-line";
export const lineTopic = (token: string) => `worker-line:${token}`;

export const TERMINAL_REFUSAL =
  "A terminal on a worker opens only with your approval: Touch ID in Weft on your Mac, which this worker must trust (weft-worker trust).";

// The terminal channel's messages (lib/host-line-terminal.ts on the worker, lib/line-terminal.ts on the board).
export type TerminalIn =
  | { t: "open"; folder: string; cols: number; rows: number; widen: unknown }
  | { t: "input"; data: string }
  | { t: "resize"; cols: number; rows: number };
export type TerminalOut = { t: "opened" } | { t: "data"; data: string } | { t: "exit"; code: number } | { t: "refused"; message: string };

// A terminal's size: whole cells, within what a screen could show.
const cells = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max;

// A STUN or TURN server, as RTCPeerConnection and werift take it.
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// The sealed answer comes back on this topic as the screen's does (rtc-signal.ts ANSWER_EVENT).
// What the board seals to the worker's key: its offer, the one-time key the answer comes back under, the topic it
// listens on, and the ICE servers both sides use (TURN credentials are minted per board, lib/rtc-ice.ts).
export interface LineOffer {
  sdp: string;
  key: string;
  topic: string;
  ice: IceServer[];
}

export interface HostCall {
  id: number;
  verb: string;
  args: Record<string, unknown>;
}
export type HostReply = { id: number; ok: true; result: HostResult } | { id: number; ok: false; error: string };

export type LineEvent =
  | { t: "card"; card: Card }
  | { t: "card_deleted"; id: string }
  | { t: "thread"; cardId: string; index: number; item: ThreadItem; truncate?: boolean }
  | { t: "thread_cleared"; cardId: string };

// A watched device to carry as a track on the line, and the label of the input channel that goes with it
// (`input:<device>:<nonce>`): that channel closing is what stops this track, not one before or after it.
export interface LineScreen {
  device: string;
  quality?: ScreenQuality;
  channel?: string;
}

export const screenChannel = (device: string, nonce: string) => `input:${device}:${nonce}`;
// `input:<device>:<nonce>`: a device id (a simulator's UDID) and 8 to 32 hex digits, nothing else.
const SCREEN_CHANNEL = /^input:([A-Za-z0-9-]{1,64}):[0-9a-f]{8,32}$/;
// The device a well-formed input channel's label names, or null for any other label.
export function deviceOfChannel(label: string): string | null {
  return SCREEN_CHANNEL.exec(label)?.[1] ?? null;
}
export type Control =
  | { t: "ping"; at: number }
  | { t: "pong"; at: number }
  | { t: "offer"; sdp: string; screen?: LineScreen }
  | { t: "answer"; sdp: string }
  | { t: "error"; message: string };

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parse(raw: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

function iceServer(v: unknown): IceServer | null {
  if (!isObject(v)) return null;
  const urls = Array.isArray(v.urls) ? v.urls.filter(str) : str(v.urls) ? v.urls : null;
  if (!urls || (Array.isArray(urls) && !urls.length)) return null;
  const out: IceServer = { urls };
  if (str(v.username)) out.username = v.username;
  if (str(v.credential)) out.credential = v.credential;
  return out;
}

export const iceServers = (v: unknown): IceServer[] => (Array.isArray(v) ? v.map(iceServer).filter((s): s is IceServer => s !== null) : []);

// The worker's reading of the opened offer. Null for anything short of a whole one.
export function readLineOffer(raw: string): LineOffer | null {
  const p = parse(raw);
  if (!p || !str(p.sdp) || !str(p.key) || !str(p.topic)) return null;
  return { sdp: p.sdp, key: p.key, topic: p.topic, ice: iceServers(p.ice) };
}

export function readHostCall(raw: string): HostCall | null {
  const p = parse(raw);
  if (!p || !num(p.id) || !str(p.verb)) return null;
  return { id: p.id, verb: p.verb, args: isObject(p.args) ? p.args : {} };
}

export function readHostReply(raw: string): HostReply | null {
  const p = parse(raw);
  if (!p || !num(p.id)) return null;
  if (p.ok === true && isObject(p.result)) return { id: p.id, ok: true, result: p.result as HostResult };
  if (p.ok === false && str(p.error)) return { id: p.id, ok: false, error: p.error };
  return null;
}

export function readLineEvent(raw: string): LineEvent | null {
  const p = parse(raw);
  if (!p) return null;
  if (p.t === "card" && isObject(p.card) && str(p.card.id)) return { t: "card", card: p.card as unknown as Card };
  if (p.t === "card_deleted" && str(p.id)) return { t: "card_deleted", id: p.id };
  if (p.t === "thread_cleared" && str(p.cardId)) return { t: "thread_cleared", cardId: p.cardId };
  if (p.t !== "thread" || !str(p.cardId) || !num(p.index) || !isObject(p.item)) return null;
  return { t: "thread", cardId: p.cardId, index: p.index, item: p.item as unknown as ThreadItem, ...(p.truncate === true ? { truncate: true } : {}) };
}

function lineScreen(v: unknown): LineScreen | undefined {
  if (!isObject(v) || !str(v.device)) return undefined;
  return { device: v.device, ...(str(v.quality) ? { quality: v.quality as ScreenQuality } : {}), ...(str(v.channel) ? { channel: v.channel } : {}) };
}

export function readControl(raw: string): Control | null {
  const p = parse(raw);
  if (!p) return null;
  if ((p.t === "ping" || p.t === "pong") && num(p.at)) return { t: p.t, at: p.at };
  if (p.t === "answer" && str(p.sdp)) return { t: "answer", sdp: p.sdp };
  if (p.t === "error" && str(p.message)) return { t: "error", message: p.message };
  if (p.t !== "offer" || !str(p.sdp)) return null;
  const screen = lineScreen(p.screen);
  return screen ? { t: "offer", sdp: p.sdp, screen } : { t: "offer", sdp: p.sdp };
}

export function readTerminalIn(raw: string): TerminalIn | null {
  const p = parse(raw);
  if (!p) return null;
  if (p.t === "input" && typeof p.data === "string") return { t: "input", data: p.data };
  if (p.t === "resize" && cells(p.cols, 1000) && cells(p.rows, 500)) return { t: "resize", cols: p.cols, rows: p.rows };
  if (p.t !== "open" || !str(p.folder) || !cells(p.cols, 1000) || !cells(p.rows, 500)) return null;
  return { t: "open", folder: p.folder, cols: p.cols, rows: p.rows, widen: p.widen };
}

export function readTerminalOut(raw: string): TerminalOut | null {
  const p = parse(raw);
  if (!p) return null;
  if (p.t === "opened") return { t: "opened" };
  if (p.t === "data" && typeof p.data === "string") return { t: "data", data: p.data };
  if (p.t === "exit" && num(p.code)) return { t: "exit", code: p.code };
  return p.t === "refused" && str(p.message) ? { t: "refused", message: p.message } : null;
}
