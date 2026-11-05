// The screen as an RTP video track (docs/architecture/weft-worker.md#the-fast-path). idb's H.264 access units (Annex B)
// are cut into RTP packets (single NAL, STAP-A, FU-A; packetization-mode 1) and sent on the video m-line the board
// offered. Unlike the "video" DataChannel, a lost packet only costs its own frame: nothing queues behind it, NACK repairs
// what it can and a PLI gets a fresh key frame. The board plays it in a <video> with the browser's own decoder.
import { H264Packetizer, MediaStreamTrack, useH264 as h264, type RTCRtpCodecParameters } from "werift";
import type { IdbSession } from "./idb-session";
import { VIDEO } from "./idb-companion";
import { bitrateControl, feedbackOf, type RtcpLike } from "./rtp-bitrate";
import { DEFAULT_QUALITY, type ScreenQuality } from "./rtc-signal";

// RTP's video clock.
const CLOCK = 90;
// Room for SRTP, the RTP header and its extensions inside a 1280-byte packet.
const MAX_PAYLOAD = 1_100;
// A burst of PLIs (one per lost packet run) gets one key frame a second, not one each.
const KEY_GAP_MS = 1_000;

// High first: idb encodes High profile (level 5.1 at full size), and a High decoder takes Constrained Baseline too.
const fmtp = (profile: string) => `profile-level-id=${profile};packetization-mode=1;level-asymmetry-allowed=1`;
export const H264_CODECS = (): RTCRtpCodecParameters[] => [h264({ parameters: fmtp("64001f") }), h264({ parameters: fmtp("42e01f") })];

export interface VideoSender {
  sendRtp(packet: never): Promise<unknown>;
  onRtcp: { subscribe(fn: (packet: RtcpLike) => void): unknown };
  onReady: { subscribe(fn: () => void): unknown };
  ssrc: number;
}
export interface VideoTransceiver {
  kind: string;
  codecs: unknown[];
  sender: VideoSender & { replaceTrack(track: unknown): Promise<unknown> };
  setDirection(direction: "sendonly"): void;
}

// The board's video m-line, taken for sending, or null when it offered none or no H.264 both sides share: the screen
// then goes on the "video" DataChannel. Called between setRemoteDescription and createAnswer.
export function takeVideo(transceivers: VideoTransceiver[]): VideoSender | null {
  const t = transceivers.find((x) => x.kind === "video" && x.codecs.length > 0);
  if (!t) return null;
  t.setDirection("sendonly");
  void t.sender.replaceTrack(new MediaStreamTrack({ kind: "video" })).catch(() => {});
  return t.sender;
}

// One access unit's packets, stamped on the 90 kHz clock from when it arrived.
export function packetizer(start = Date.now()) {
  const p = new H264Packetizer({ inputFormat: "annexb", maxPayloadSize: MAX_PAYLOAD });
  return (frame: Buffer, at = Date.now()) => p.packetize(frame, ((at - start) * CLOCK) >>> 0);
}

// Sends the screen on the track from when DTLS connects until stop(), restarting idb's stream for a key frame (a PLI
// or FIR) or a new bitrate (lib/rtp-bitrate.ts), since its stream takes neither once it's running.
export function rtpVideo(idb: Pick<IdbSession, "video">, sender: VideoSender, quality: ScreenQuality = DEFAULT_QUALITY, now: () => number = Date.now) {
  const packets = packetizer(now());
  const control = bitrateControl(VIDEO[quality].avg_bitrate, now);
  let stop: (() => void) | null = null;
  let over = false;
  let keyAt = -Infinity;
  const begin = () => {
    stop?.();
    stop = null;
    if (over) return;
    const ended = idb.video(
      (frame) => packets(frame, now()).forEach((packet) => void sender.sendRtp(packet as never).catch(() => {})),
      () => {
        if (stop === ended) stop = null;
      },
      quality,
      control.rate,
    );
    stop = ended;
  };
  sender.onReady.subscribe(() => {
    if (!stop) begin();
  });
  sender.onRtcp.subscribe((packet) => {
    if (!stop) return;
    const f = feedbackOf(packet, sender.ssrc);
    if (control.report(f) !== null) begin();
    else if (f.keyframe && now() - keyAt >= KEY_GAP_MS) {
      keyAt = now();
      begin();
    }
  });
  return () => {
    over = true;
    stop?.();
    stop = null;
  };
}
