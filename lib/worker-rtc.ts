// A worker's end of the WebRTC line to a board (docs/architecture/weft-worker.md#the-fast-path). One peer connection with
// named channels: whatever wants the line (the screen, the session line's host, events and line channels in
// lib/host-line.ts) registers a channel, and the board opens it by name. Media goes on the m-lines the board offered (the
// screen's video track, lib/rtp-video.ts). A later offer over the line itself renegotiates it (`renegotiate`), so adding
// the screen's track or restarting ICE doesn't go back through Supabase. Durable work stays on Supabase.
import { RTCPeerConnection, useAbsSendTime as absSendTime, type RTCDataChannel } from "werift";
import type { IceServer } from "./host-line-protocol";
import { STUN } from "./rtc-signal";
import { H264_CODECS, type VideoTransceiver } from "./rtp-video";

const GATHER_MS = 3_000;

export type Channel = Pick<RTCDataChannel, "label" | "send" | "bufferedAmount" | "onMessage" | "stateChanged">;
export type Channels = Record<string, (channel: Channel) => void>;

interface Peer {
  onDataChannel: { subscribe(fn: (channel: Channel) => void): unknown };
  iceGatheringStateChange: { subscribe(fn: (state: string) => void): unknown };
  iceGatheringState: string;
  setRemoteDescription(d: { type: "offer"; sdp: string }): Promise<unknown>;
  getTransceivers(): VideoTransceiver[];
  createAnswer(): Promise<unknown>;
  setLocalDescription(d: never): Promise<unknown>;
  localDescription: { sdp: string } | null | undefined;
  close(): Promise<unknown>;
  connectionStateChange?: { subscribe(fn: (state: string) => void): unknown };
}

export type MakePeer = (ice?: IceServer[]) => Peer;
// H.264 only for video; abs-send-time lets the board's receiver estimate the line and send REMB. The ICE servers are the
// board's when its offer names them (TURN credentials minted for it, lib/rtc-ice.ts), else Cloudflare's STUN.
// The board's servers come out of a sealed offer, but a worker still only relays through Cloudflare's: an address
// elsewhere would let whoever made the offer route the worker's traffic through a server of their choosing.
const CLOUDFLARE_ICE = /^(stun|turns?):([a-z0-9-]+\.)*cloudflare\.com(:\d{1,5})?(\?transport=(udp|tcp))?$/i;

export function peerIce(ice?: IceServer[]): IceServer[] {
  const kept = (ice ?? []).flatMap((server) => {
    const urls = [server.urls].flat().filter((url) => CLOUDFLARE_ICE.test(url));
    return urls.length ? [{ ...server, urls }] : [];
  });
  return kept.length ? kept : [{ urls: STUN }];
}
const realPeer: MakePeer = (ice) =>
  new RTCPeerConnection({ iceServers: peerIce(ice), codecs: { video: H264_CODECS() }, headerExtensions: { video: [absSendTime()] } });

export interface AnswerOptions {
  // Takes the offered media m-lines before the answer is made; whatever it leaves alone is answered inactive.
  media?: (transceivers: VideoTransceiver[]) => void;
  make?: MakePeer;
  wait?: number;
  ice?: IceServer[];
}

function gathered(peer: Peer, wait: number) {
  return new Promise<void>((done) => {
    if (peer.iceGatheringState === "complete") {
      done();
      return;
    }
    const timer = setTimeout(done, wait);
    peer.iceGatheringStateChange.subscribe((state) => {
      if (state !== "complete") return;
      clearTimeout(timer);
      done();
    });
  });
}

async function answerWith(peer: Peer, sdp: string, media: AnswerOptions["media"], wait: number) {
  await peer.setRemoteDescription({ type: "offer", sdp });
  media?.(peer.getTransceivers());
  await peer.setLocalDescription((await peer.createAnswer()) as never);
  await gathered(peer, wait);
  const answer = peer.localDescription?.sdp;
  if (!answer) throw new Error("WebRTC made no answer.");
  return answer;
}

// Answers an offer. Candidates go inside the answer rather than one by one, since it's a single sealed message. A label
// with no handler of its own goes to `"*"`, when there is one (the screen's `input:<device>` on a session line).
export async function answerOffer(sdp: string, channels: Channels, { media, make = realPeer, wait = GATHER_MS, ice }: AnswerOptions = {}) {
  const peer = make(ice);
  peer.onDataChannel.subscribe((channel) => (channels[channel.label] ?? channels["*"])?.(channel));
  const answer = await answerWith(peer, sdp, media, wait);
  return {
    answer,
    close: () => void peer.close().catch(() => {}),
    // A later offer from the same board, over the line: the same peer, new m-lines or new ICE credentials.
    renegotiate: (next: string, more?: AnswerOptions["media"]) => answerWith(peer, next, more, wait),
    // Calls back once when the connection fails or closes.
    onClosed(fn: () => void) {
      let done = false;
      peer.connectionStateChange?.subscribe((state) => {
        if (done || (state !== "failed" && state !== "closed")) return;
        done = true;
        fn();
      });
    },
  };
}
