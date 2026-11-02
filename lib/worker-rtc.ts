// A worker's end of the WebRTC line to a board (docs/architecture/weft-worker.md#the-fast-path). One peer connection with
// named channels: whatever wants the line (the screen today, the QA debugger next) registers a channel, and the board
// opens it by name. Media goes on the m-lines the board offered (the screen's video track, lib/rtp-video.ts). A live line
// only exists while someone is watching, so durable work stays on Supabase.
import { RTCPeerConnection, useAbsSendTime as absSendTime, type RTCDataChannel } from "werift";
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
}

export type MakePeer = () => Peer;
// H.264 only for video; abs-send-time lets the board's receiver estimate the line and send REMB.
const realPeer: MakePeer = () =>
  new RTCPeerConnection({ iceServers: [{ urls: STUN }], codecs: { video: H264_CODECS() }, headerExtensions: { video: [absSendTime()] } });

export interface AnswerOptions {
  // Takes the offered media m-lines before the answer is made; whatever it leaves alone is answered inactive.
  media?: (transceivers: VideoTransceiver[]) => void;
  make?: MakePeer;
  wait?: number;
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

// Answers an offer. Candidates go inside the answer rather than one by one, since it's a single sealed message.
export async function answerOffer(sdp: string, channels: Channels, { media, make = realPeer, wait = GATHER_MS }: AnswerOptions = {}) {
  const peer = make();
  peer.onDataChannel.subscribe((channel) => channels[channel.label]?.(channel));
  await peer.setRemoteDescription({ type: "offer", sdp });
  media?.(peer.getTransceivers());
  await peer.setLocalDescription((await peer.createAnswer()) as never);
  await gathered(peer, wait);
  const answer = peer.localDescription?.sdp;
  if (!answer) throw new Error("WebRTC made no answer.");
  return { answer, close: () => void peer.close().catch(() => {}) };
}
