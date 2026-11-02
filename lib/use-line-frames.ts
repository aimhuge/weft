"use client";

// A worker card's headless browser, live on the session line (lib/worker-browser-screen.ts): no video m-line, since a
// browser has no H.264 to send, only an `input:<device>:<nonce>` channel added over the line. The worker sends the
// page's JPEG frames down it, length-prefixed like the fast path's video (lib/h264-frames.ts frameReader), drawn here on
// the screen's canvas; the board's pointer and keys go up the same channel. Off the line, the pane keeps the Realtime JPEGs.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { screenChannel } from "./host-line-protocol";
import { frameReader } from "./h264-frames";
import { lineToken } from "./line-answer";
import type { LiveEvent } from "./rtc-signal";
import { lineFor, useLineRoute } from "./session-lines";
import type { LineScreenView } from "./use-line-screen";

// Draws each JPEG as it decodes; one that finishes after a newer one is dropped.
export function jpegPainter(canvasEl: RefObject<HTMLCanvasElement | null>, onDrawn: () => void) {
  let seq = 0;
  let shown = 0;
  return (bytes: Uint8Array) => {
    const mine = ++seq;
    void createImageBitmap(new Blob([bytes.slice()], { type: "image/jpeg" }))
      .then((img) => {
        const el = canvasEl.current;
        if (el && mine > shown) {
          shown = mine;
          if (el.width !== img.width || el.height !== img.height) Object.assign(el, { width: img.width, height: img.height });
          el.getContext("2d")?.drawImage(img, 0, 0);
          onDrawn();
        }
        img.close();
      })
      .catch(() => {});
  };
}

export function useLineFrames(workerId: string | undefined, device: string, enabled: boolean, canvasEl: RefObject<HTMLCanvasElement | null>): LineScreenView {
  const direct = useLineRoute(workerId)?.kind === "direct";
  const [live, setLive] = useState(false);
  const input = useRef<RTCDataChannel | null>(null);
  const on = Boolean(enabled && direct && workerId);

  useEffect(() => {
    const line = lineFor(workerId);
    if (!on || !line) return;
    let channel: RTCDataChannel | null = null;
    let ended = false;
    const label = screenChannel(device, lineToken().slice(0, 8));
    const read = frameReader(jpegPainter(canvasEl, () => !ended && setLive(true)));
    line
      .renegotiate(
        (pc) => {
          channel = pc.createDataChannel(label, { ordered: true });
          const opened = channel;
          opened.binaryType = "arraybuffer";
          opened.onopen = () => (input.current = opened);
          opened.onmessage = (e: MessageEvent) => e.data instanceof ArrayBuffer && read(new Uint8Array(e.data));
        },
        { device, channel: label },
      )
      .catch(() => {});
    return () => {
      ended = true;
      setLive(false);
      input.current = null;
      // Closing the channel is how the worker hears this view left.
      (channel)?.close();
    };
  }, [on, workerId, device, canvasEl]);

  const send = useCallback((event: LiveEvent) => {
    const channel = input.current;
    if (channel?.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);
  return { on, live: on && live, send };
}
