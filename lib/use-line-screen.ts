"use client";

// A watched simulator as a track on the worker's session line (docs/architecture/project-hosts.md#routes-the-webrtc-line):
// instead of a line of its own, the screen adds a receive-only H.264 m-line and an `input:<device>` channel to the line
// that's already up, renegotiated over the line itself. The worker answers with the watched device's video on that
// m-line (lib/host-line.ts) and stops it when the input channel closes. While the line isn't up, or the attach failed,
// `on` is false and the screen opens its own line as before (lib/use-rtc-screen.ts).
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { LiveEvent, ScreenQuality } from "./rtc-signal";
import { offerVideoTrack, playTrack } from "./rtc-video-track";
import { lineFor, useLineRoute } from "./session-lines";
import { screenChannel } from "./host-line-protocol";
import { lineToken } from "./line-answer";
import { useRtcScreen, type RtcScreen } from "./use-rtc-screen";
import type { BoardInput } from "./worker-commands";

export interface LineScreenView {
  // The line carries (or is trying to carry) this screen, so the screen's own line stays shut.
  on: boolean;
  live: boolean;
  send: (event: LiveEvent) => boolean;
}

export function useLineScreen(workerId: string | undefined, device: string, fast: boolean, quality: ScreenQuality, videoEl: RefObject<HTMLVideoElement | null>): LineScreenView {
  const direct = useLineRoute(workerId)?.kind === "direct";
  const [failed, setFailed] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const input = useRef<RTCDataChannel | null>(null);
  const attempt = `${workerId} ${device} ${quality}`;
  const on = Boolean(fast && direct && workerId && failed !== attempt);

  useEffect(() => {
    const line = lineFor(workerId);
    const el = videoEl.current;
    if (!on || !line || !el) return;
    let channel: RTCDataChannel | null = null;
    let ended = false;
    const label = screenChannel(device, lineToken().slice(0, 8));
    line
      .renegotiate(
        (pc) => {
          if (!offerVideoTrack(pc)) throw new Error("This board can't play H.264 over RTP.");
          pc.addEventListener("track", (e: RTCTrackEvent) => playTrack(el, e.track, () => !ended && setLive(true)), { once: true });
          channel = pc.createDataChannel(label, { ordered: true });
          const opened = channel;
          opened.onopen = () => (input.current = opened);
        },
        { device, quality, channel: label },
      )
      .catch(() => !ended && setFailed(attempt));
    return () => {
      ended = true;
      setLive(false);
      input.current = null;
      // Closing the input channel is how the worker hears this screen left: it stops the track.
      (channel)?.close();
      el.srcObject = null;
    };
  }, [on, workerId, device, quality, videoEl, attempt]);

  const send = useCallback((event: LiveEvent) => {
    const channel = input.current;
    if (channel?.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);
  return { on, live: on && live, send };
}

// The screen's video by whichever route has it: the session line's track while it carries the screen, else the
// screen's own line (lib/use-rtc-screen.ts), which stays shut meanwhile. Gestures go on whichever is open.
export function useScreenVideo(
  workerId: string | undefined,
  device: string,
  fast: boolean,
  canvasEl: RefObject<HTMLCanvasElement | null>,
  onOffer: ((input: BoardInput) => Promise<unknown>) | undefined,
  quality: ScreenQuality,
  videoEl: RefObject<HTMLVideoElement | null>,
): RtcScreen {
  const onLine = useLineScreen(workerId, device, fast, quality, videoEl);
  const own = useRtcScreen(device, fast && !onLine.on, canvasEl, onOffer, quality, videoEl);
  return {
    live: onLine.live || own.live,
    track: onLine.live || own.track,
    send: (event) => onLine.send(event) || own.send(event),
    answer: own.answer,
  };
}
