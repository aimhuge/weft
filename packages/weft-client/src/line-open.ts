// Opening a session line from any board (docs/architecture/project-hosts.md#the-session-line-h6-as-built), with the
// platform's own RTCPeerConnection handed in: the browser's on the desktop and weft.zip (lib/session-line.ts), and
// react-native-webrtc's on the phone. The package has no DOM and no timers, so the peer, the clock (`wait`) and the
// Broadcast listener come from the caller.
//
//   offer  createOffer ─ gather (up to GATHER_MS) ─ a one-time answer key and a topic only this offer names ─ listen
//   send   the offer, sealed to the worker's key: by the Mac's server (desktop) or by the board itself (line-offer.ts)
//   answer arrives sealed under the one-time key; one that doesn't open (forged, stale, another offer's) is dropped
import { LINE_CHANNELS, lineTopic, type IceServer, type LineOffer } from "./line-offer";
import type { AnswerKeys, SealedAnswer } from "./seal";

export const GATHER_MS = 2_500;
// Finds each side's public address so the two can connect directly; it never sees the traffic.
export const STUN = "stun:stun.cloudflare.com:3478";

// A session description as RTCPeerConnection takes and gives it.
export interface SdpInit {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
}

// The members of RTCPeerConnection the offer uses; the DOM's, werift's and react-native-webrtc's all fit.
export interface OfferPeer {
  readonly iceGatheringState: string;
  readonly localDescription: { sdp: string } | null;
  createOffer(options?: { iceRestart?: boolean }): Promise<SdpInit>;
  setLocalDescription(description: SdpInit): Promise<void>;
  setRemoteDescription(description: { type: "answer"; sdp: string }): Promise<void>;
  addEventListener(type: "icegatheringstatechange", listener: () => void): void;
}

export interface LinePeer<C> extends OfferPeer {
  createDataChannel(label: string, init: { ordered: boolean }): C;
  close(): void;
}

export type Listen = (topic: string, onAnswer: (sealed: SealedAnswer) => void) => () => void;

export interface OfferDeps {
  keys: AnswerKeys;
  listen: Listen;
  // 128 random bits as hex: the topic's secret part.
  token: () => string;
  wait: (ms: number) => Promise<void>;
  // False once this attempt is over, so a late answer never lands on a peer that was replaced.
  current: () => boolean;
}

// Waits for ICE gathering to finish, or GATHER_MS, whichever comes first, so the offer carries its candidates.
export function gathered(pc: OfferPeer, wait: (ms: number) => Promise<void>): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  const complete = new Promise<void>((done) => {
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") done();
    });
  });
  return Promise.race([complete, wait(GATHER_MS)]);
}

// The offer for a peer whose channels are already made, listening for its answer. `stop` stops listening; `take` lands an
// answer that came another way (a LAN offer's reply), through the same checks.
export async function offerLine(pc: OfferPeer, ice: IceServer[], deps: OfferDeps): Promise<{ offer: LineOffer; stop: () => void; take: (sealed: SealedAnswer) => void }> {
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc, deps.wait);
  const key = deps.keys.newKey();
  const topic = lineTopic(deps.token());
  const take = (sealed: SealedAnswer) => {
    void deps.keys
      .open(key, sealed)
      .then((sdp) => (deps.current() ? pc.setRemoteDescription({ type: "answer", sdp }) : undefined))
      .catch(() => {});
  };
  const stop = deps.listen(topic, take);
  return { offer: { sdp: pc.localDescription?.sdp ?? "", key, topic, ice }, stop, take };
}

export interface OpenLineDeps<C> extends Omit<OfferDeps, "current"> {
  peer: (ice: IceServer[]) => LinePeer<C>;
  // STUN alone when this fails.
  ice: () => Promise<IceServer[]>;
  // Sends the offer: line-offer.ts lineOpener on a board that seals its own.
  offer: (workerId: string, offer: LineOffer) => Promise<unknown>;
}

export interface OpenedLine<C> {
  pc: LinePeer<C>;
  host: C;
  events: C;
  control: C;
  // Stops listening for the answer (once the channels open, or on giving up).
  stopListening: () => void;
  close: () => void;
}

// A whole line's opening for a board that keeps the rest itself (the phone): the peer, its three channels, the offer
// sent. Resolves once the offer is in; the answer lands on the peer by itself, and the channels open after it.
export async function openLine<C>(workerId: string, deps: OpenLineDeps<C>): Promise<OpenedLine<C>> {
  const ice = await deps.ice().catch(() => [{ urls: STUN }]);
  const pc = deps.peer(ice);
  const make = (label: string) => pc.createDataChannel(label, { ordered: true });
  const [host, events, control] = [make(LINE_CHANNELS.host), make(LINE_CHANNELS.events), make(LINE_CHANNELS.control)];
  let live = true;
  let stop = () => {};
  const close = () => {
    live = false;
    stop();
    pc.close();
  };
  try {
    const made = await offerLine(pc, ice, { ...deps, current: () => live });
    stop = made.stop;
    // An offer that went straight to the worker (over the LAN) may come back with its answer.
    const sent = await deps.offer(workerId, made.offer);
    const direct = (sent as { answer?: SealedAnswer } | null | undefined)?.answer;
    if (direct) made.take(direct);
  } catch (err) {
    close();
    throw err;
  }
  return { pc, host, events, control, stopListening: () => stop(), close };
}
