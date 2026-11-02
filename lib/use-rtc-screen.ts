"use client";

// The board's end of the WebRTC line to a worker's device (docs/architecture/weft-worker.md#the-fast-path). It makes an
// offer, sends it through the elevated input command (onOffer), and takes the answer off the watch's Broadcast topic.
// H.264 arrives on an RTP video track played in a <video> (lib/rtc-video-track.ts), or, from a worker without it, on the
// "video" channel, decoded onto a canvas; "input" carries the live gesture and keyboard. Any failure just
// leaves the view on the JPEGs (lib/use-screen-stream.ts), which never stop, and a later try may still connect.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { codecOf, frameReader, isKey } from "./h264-frames";
import { offerVideoTrack, playTrack } from "./rtc-video-track";
import { DEFAULT_QUALITY, newAnswerKey, openAnswer, STUN, type LiveEvent, type ScreenQuality, type SealedAnswer } from "./rtc-signal";
import type { BoardInput } from "./worker-commands";

const GATHER_MS = 2_500;
// A command's round trip, then the worker's own gathering.
const ANSWER_MS = 15_000;
// Each try is a command, so a network that can't connect shouldn't send one every few seconds.
const RETRY_MS = 30_000;

function decoderFor(canvas: () => HTMLCanvasElement | null, onError: () => void) {
  let ts = 0;
  const decoder = new VideoDecoder({
    output(frame) {
      const el = canvas();
      if (el) {
        if (el.width !== frame.displayWidth) el.width = frame.displayWidth;
        if (el.height !== frame.displayHeight) el.height = frame.displayHeight;
        el.getContext("2d")?.drawImage(frame, 0, 0);
      }
      frame.close();
    },
    error: onError,
  });
  return {
    push(data: Uint8Array) {
      const key = isKey(data);
      if (decoder.state === "unconfigured") {
        const codec = codecOf(data);
        if (!key || !codec) return;
        decoder.configure({ codec, optimizeForLatency: true });
      }
      if (decoder.state === "configured") decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: (ts += 33_333), data }));
    },
    close() {
      if (decoder.state !== "closed") decoder.close();
    },
  };
}

function gathered(pc: RTCPeerConnection) {
  return new Promise<void>((done) => {
    if (pc.iceGatheringState === "complete") {
      done();
      return;
    }
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState !== "complete") return;
      clearTimeout(timer);
      done();
    });
  });
}

export interface RtcScreen {
  // True while video is drawing.
  live: boolean;
  // True when it's drawing in the <video>, off the track, rather than on the canvas.
  track: boolean;
  // Sends a live event; false means the line isn't open, and the caller uses the command path.
  send: (event: LiveEvent) => boolean;
  answer: (sealed: SealedAnswer) => void;
}

type Attempt = { pc: RTCPeerConnection; key: string };

// A new quality closes the line and offers again at once: the worker's encoder takes its settings when the video starts.
// A track that negotiated but never showed a frame (a decoder that won't take it) isn't offered again, so the next try
// falls back to the channel.
export function useRtcScreen(
  device: string,
  fast: boolean,
  canvasEl: RefObject<HTMLCanvasElement | null>,
  onOffer?: (input: BoardInput) => Promise<unknown>,
  quality: ScreenQuality = DEFAULT_QUALITY,
  videoEl?: RefObject<HTMLVideoElement | null>,
): RtcScreen {
  const attempt = useRef<Attempt | null>(null);
  const noTrack = useRef(false);
  const input = useRef<RTCDataChannel | null>(null);
  const offering = useRef(onOffer);
  useEffect(() => {
    offering.current = onOffer;
  });
  const [live, setLive] = useState(false);
  const [track, setTrack] = useState(false);
  const canOffer = Boolean(onOffer);

  useEffect(() => {
    if (!fast || !canOffer || typeof RTCPeerConnection === "undefined" || typeof VideoDecoder === "undefined") return;
    let ended = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cleanup = () => {};

    const connect = async () => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN }] });
      const decoder = decoderFor(() => canvasEl.current, () => pc.close());
      let settled = false;
      const again = () => {
        if (settled) return;
        settled = true;
        pc.close();
        decoder.close();
        input.current = null;
        setLive(false);
        setTrack(false);
        if (videoEl?.current) videoEl.current.srcObject = null;
        if (!ended) retry = setTimeout(() => void connect(), RETRY_MS);
      };
      cleanup = again;
      let tracked = false;
      const giveUp = setTimeout(() => {
        if (tracked) noTrack.current = true;
        again();
      }, ANSWER_MS);
      const el = videoEl?.current;
      if (el && !noTrack.current && offerVideoTrack(pc)) {
        pc.addEventListener("track", (e: RTCTrackEvent) => {
          tracked = true;
          playTrack(el, e.track, () => {
            clearTimeout(giveUp);
            setTrack(true);
            setLive(true);
          });
        });
      }
      const video = pc.createDataChannel("video", { ordered: true });
      video.binaryType = "arraybuffer";
      const read = frameReader((frame) => {
        clearTimeout(giveUp);
        decoder.push(frame);
        setLive(true);
      });
      video.onmessage = (e: MessageEvent<ArrayBuffer>) => read(new Uint8Array(e.data));
      video.onclose = again;
      const events = pc.createDataChannel("input", { ordered: true });
      events.onopen = () => {
        input.current = events;
      };
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") again();
      });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const key = newAnswerKey();
      attempt.current = { pc, key };
      await offering.current?.({ kind: "offer", device, sdp: pc.localDescription?.sdp ?? "", key, quality });
    };
    void connect().catch(() => cleanup());
    return () => {
      ended = true;
      clearTimeout(retry);
      cleanup();
    };
  }, [fast, canOffer, device, canvasEl, quality, videoEl]);

  const answer = useCallback((sealed: SealedAnswer) => {
    const now = attempt.current;
    if (!now) return;
    // A forged or stale answer fails to open and is dropped; the attempt then times out to the JPEGs.
    void openAnswer(now.key, sealed)
      .then((sdp) => now.pc.setRemoteDescription({ type: "answer", sdp }))
      .catch(() => {});
  }, []);
  const send = useCallback((event: LiveEvent) => {
    const channel = input.current;
    if (channel?.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);
  return { live, track, send, answer };
}
