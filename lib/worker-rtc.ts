// A worker's end of the WebRTC line to a board (docs/architecture/weft-worker.md#the-fast-path). One peer connection with
// named channels: whatever wants the line (the screen today, the QA debugger next) registers a channel, and the board
// opens it by name. A live line only exists while someone is watching, so durable work stays on Supabase.
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import { STUN } from "./rtc-signal";

const GATHER_MS = 3_000;

export type Channel = Pick<RTCDataChannel, "label" | "send" | "bufferedAmount" | "onMessage" | "stateChanged">;
export type Channels = Record<string, (channel: Channel) => void>;

interface Peer {
  onDataChannel: { subscribe(fn: (channel: Channel) => void): unknown };
  iceGatheringStateChange: { subscribe(fn: (state: string) => void): unknown };
  iceGatheringState: string;
  setRemoteDescription(d: { type: "offer"; sdp: string }): Promise<unknown>;
  createAnswer(): Promise<unknown>;
  setLocalDescription(d: never): Promise<unknown>;
  localDescription: { sdp: string } | null | undefined;
  close(): Promise<unknown>;
}

export type MakePeer = () => Peer;
const realPeer: MakePeer = () => new RTCPeerConnection({ iceServers: [{ urls: STUN }] });

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
export async function answerOffer(sdp: string, channels: Channels, make: MakePeer = realPeer, wait = GATHER_MS) {
  const peer = make();
  peer.onDataChannel.subscribe((channel) => channels[channel.label]?.(channel));
  await peer.setRemoteDescription({ type: "offer", sdp });
  await peer.setLocalDescription((await peer.createAnswer()) as never);
  await gathered(peer, wait);
  const answer = peer.localDescription?.sdp;
  if (!answer) throw new Error("WebRTC made no answer.");
  return { answer, close: () => void peer.close().catch(() => {}) };
}
