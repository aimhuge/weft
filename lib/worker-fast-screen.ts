// Joins a device to the WebRTC line for one watch (docs/architecture/weft-worker.md#the-fast-path): idb on iOS, adb's
// screenrecord on Android (lib/adb-screen.ts). H.264 goes on the board's video track where it offered one
// (lib/rtp-video.ts), else on the "video" channel; "input" carries the live gesture, the keyboard and a paste.
import { openAdbScreen } from "./adb-screen";
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

// What a watched device gives the line: idb's session on iOS, adb's on Android.
export type LiveDevice = Pick<IdbSession, "size" | "touch" | "key" | "text" | "video" | "close">;

// Fractions become the device's own units here (points on iOS, pixels on Android), so nothing on the wire depends on its size.
export function inputChannel(idb: Pick<LiveDevice, "size" | "touch" | "key" | "text">, channel: Pick<Channel, "onMessage">) {
  channel.onMessage.subscribe((raw) => {
    const event = liveEvent(raw.toString());
    if (!event) return;
    if (event.t === "key") idb.key(event.code, event.down);
    else if (event.t === "text") idb.text(event.text);
    else idb.touch(event.t, event.x * idb.size.width, event.y * idb.size.height);
  });
}

// Null on a box without the device's tool (idb_companion, adb): that watch stays on the JPEG path.
const openDevice = (d: Device): Promise<LiveDevice | null> => (d.platform === "ios" ? openIdb(d.id) : openAdbScreen(d.id));

export async function openFastScreen(d: Device): Promise<FastScreen | null> {
  const idb = await openDevice(d);
  if (!idb) return null;
  let line: { close: () => void } | null = null;
  return {
    size: idb.size,
    // The screen as a track on a session line (lib/host-line.ts): the line's new video m-line, and its input channel.
    attach: (transceivers, quality) => {
      const sender = takeVideo(transceivers);
      return sender ? rtpVideo(idb, sender, quality) : null;
    },
    input: (c) => inputChannel(idb, c),
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
