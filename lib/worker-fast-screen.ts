// Joins idb to the WebRTC line for one watch (docs/architecture/weft-worker.md#the-fast-path). iOS only: Android has no
// idb, so an emulator stays on the JPEG path. H.264 goes on the board's video track where it offered one
// (lib/rtp-video.ts), else on the "video" channel; "input" carries the live gesture and keyboard.
import { openIdb } from "./idb-companion";
import type { IdbSession } from "./idb-session";
import { liveEvent, type ScreenQuality } from "./rtc-signal";
import { rtpVideo, takeVideo } from "./rtp-video";
import type { Device } from "./simulator-devices";
import { answerOffer, type Channel } from "./worker-rtc";
import type { FastScreen } from "./worker-screen";

// SCTP messages stay under this; the board's frameReader puts them back together.
const CHUNK = 16 * 1024;
// A viewer this far behind is skipped to the next key frame rather than let its queue grow.
const MAX_BEHIND = 2 * 1024 * 1024;

// True when the payload holds an IDR slice: NAL type 5 after any start code.
export function isKeyFrame(frame: Buffer) {
  for (let i = 0; i + 3 < frame.length; i++) {
    if (frame[i] === 0 && frame[i + 1] === 0 && frame[i + 2] === 1 && ((frame[i + 3] ?? 0) & 31) === 5) return true;
  }
  return false;
}

export function sendFrame(channel: Pick<Channel, "send">, frame: Buffer) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(frame.length);
  const whole = Buffer.concat([head, frame]);
  for (let at = 0; at < whole.length; at += CHUNK) channel.send(whole.subarray(at, at + CHUNK));
}

// Video runs only while a board is on the channel, and each one starts at a key frame, at the quality its offer asked for.
export function videoChannel(idb: Pick<IdbSession, "video">, channel: Channel, quality?: ScreenQuality) {
  let waiting = true;
  let stop: (() => void) | null = idb.video(
    (frame) => {
      const key = isKeyFrame(frame);
      if (channel.bufferedAmount > MAX_BEHIND) waiting = true;
      if (waiting && !key) return;
      waiting = false;
      sendFrame(channel, frame);
    },
    () => (stop = null),
    quality,
  );
  channel.stateChanged.subscribe((state) => {
    if (state !== "closed") return;
    stop?.();
    stop = null;
  });
}

export function untilClosed(channel: Pick<Channel, "stateChanged">, stop: () => void) {
  channel.stateChanged.subscribe((state) => {
    if (state === "closed") stop();
  });
}

// Fractions become points here, so nothing on the wire depends on the device's size.
export function inputChannel(idb: Pick<IdbSession, "size" | "touch" | "key">, channel: Pick<Channel, "onMessage">) {
  channel.onMessage.subscribe((raw) => {
    const event = liveEvent(raw.toString());
    if (!event) return;
    if (event.t === "key") idb.key(event.code, event.down);
    else idb.touch(event.t, event.x * idb.size.width, event.y * idb.size.height);
  });
}

export async function openFastScreen(d: Device): Promise<FastScreen | null> {
  if (d.platform !== "ios") return null;
  const idb = await openIdb(d.id);
  if (!idb) return null;
  let line: { close: () => void } | null = null;
  return {
    size: idb.size,
    connect: async (sdp, quality) => {
      line?.close();
      // Set while the answer is made, before any channel opens. A board on the track leaves its "video" channel unused,
      // and the channel closing is still how the worker hears it left.
      let track: (() => void) | null = null;
      const opened = await answerOffer(
        sdp,
        { video: (c) => (track ? untilClosed(c, track) : videoChannel(idb, c, quality)), input: (c) => inputChannel(idb, c) },
        {
          media: (transceivers) => {
            const sender = takeVideo(transceivers);
            if (sender) track = rtpVideo(idb, sender, quality);
          },
        },
      );
      line = {
        close: () => {
          track?.();
          opened.close();
        },
      };
      return opened.answer;
    },
    close: () => {
      line?.close();
      idb.close();
    },
  };
}
