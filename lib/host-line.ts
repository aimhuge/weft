// A worker's end of the session line (docs/architecture/project-hosts.md#routes-the-webrtc-line): one peer connection
// per board that shows this worker's project, opened by a sealed `line` command and answered on the board's topic under
// its one-time key, as the screen's line is (lib/worker-rtc.ts, lib/rtc-signal.ts). On it:
//
//   host      a verb runs through deps.run, the `host` command's own path (ownCard, remoteRefusal, runVerb), one at a
//             time in the order sent, so a verb over the line passes exactly the checks it would over the relay
//   events    the bus's card and thread events, projected as the relay mirrors them (lib/host-line-events.ts)
//   line      ping → pong; an offer renegotiates the same peer (a watched simulator's track, an ICE restart)
//   terminal  refused, always (TERMINAL_REFUSAL): a pty is a shell, and H2 refuses a shell from the network
//
// A line no board has pinged for QUIET_MS is closed: the board went away without saying so.
import type { FastScreen } from "./worker-screen";
import type { HostDone } from "./host-command";
import { deviceOfChannel, LINE_CHANNELS, LINE_PURPOSE, TERMINAL_REFUSAL, readControl, readHostCall, readLineOffer, type Control, type HostReply, type LineEvent } from "./host-line-protocol";
import { sealAnswer, type SealedAnswer } from "./rtc-signal";
import type { VideoTransceiver } from "./rtp-video";
import type { BoardEvent } from "./types";
import { answerOffer, type Channel, type Channels } from "./worker-rtc";
import type { Sealed } from "./worker-seal";

export const QUIET_MS = 30_000;
// A board per Mac or two; past this the oldest line closes rather than let them pile up.
export const MAX_LINES = 4;
const ERROR_MAX = 300;

export type LineChannel = Channel & { close?: () => void };

// A host command's payload, run as the relay runs it (lib/worker-card-commands.ts host); the daemon hands it in.
export type RunHost = (payload: { verb: string; args: Record<string, unknown> }) => Promise<HostDone>;

export interface HostLineDeps {
  unseal(sealed: Sealed, purpose: string): string;
  // Sends the sealed answer on the board's Broadcast topic (the worker's own Realtime client).
  answerOn(topic: string, sealed: SealedAnswer): Promise<unknown>;
  hear(listener: (event: BoardEvent) => void): () => void;
  project(event: BoardEvent): Promise<LineEvent | null>;
  screen?: (device: string) => FastScreen | null;
  answer?: typeof answerOffer;
  log?: (msg: string) => void;
  quietMs?: number;
  maxLines?: number;
  now?: () => number;
}

type Opened = Awaited<ReturnType<typeof answerOffer>>;
const send = (channel: LineChannel, message: unknown) => channel.send(JSON.stringify(message));
const closed = (channel: LineChannel, fn: () => void) =>
  channel.stateChanged.subscribe((state) => {
    if (state === "closed") fn();
  });

export function createHostLines(deps: HostLineDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;
  const lines = new Set<{ close: () => void }>();

  function hostChannel(channel: LineChannel, run: RunHost) {
    let queue = Promise.resolve();
    channel.onMessage.subscribe((raw) => {
      const call = readHostCall(raw.toString());
      if (!call) return;
      queue = queue.then(async () => {
        let reply: HostReply;
        try {
          const done = await run({ verb: call.verb, args: call.args });
          reply = { id: call.id, ok: true, result: done.result };
        } catch (err) {
          reply = { id: call.id, ok: false, error: (err as Error).message.slice(0, ERROR_MAX) };
        }
        send(channel, reply);
      });
    });
  }

  function eventsChannel(channel: LineChannel) {
    let queue = Promise.resolve();
    const off = deps.hear((event) => {
      queue = queue.then(() => deps.project(event)).then(
        (out) => {
          if (out) send(channel, out);
        },
        () => {},
      );
    });
    closed(channel, off);
  }

  // The screen's track on this line, for the device the board's offer names, when it's being watched fast; kept under its
  // input channel's label, whose closing stops it. A new one under the same key replaces the last.
  function screenMedia(control: Extract<Control, { t: "offer" }>, seen: Set<VideoTransceiver>, stops: Map<string, () => void>) {
    const screen = control.screen;
    const fast = screen ? deps.screen?.(screen.device) : null;
    return (transceivers: VideoTransceiver[]) => {
      const fresh = transceivers.filter((t) => !seen.has(t));
      fresh.forEach((t) => seen.add(t));
      const stop = screen && fast?.attach?.(fresh, screen.quality);
      if (!screen || !stop) return;
      const key = screen.channel ?? screen.device;
      stops.get(key)?.();
      stops.set(key, stop);
    };
  }

  // The screen's input:<device>: the gesture and keys, and its closing is how the board says it left.
  function screenInput(channel: LineChannel, stops: Map<string, () => void>) {
    const device = deviceOfChannel(channel.label);
    if (!device) return;
    deps.screen?.(device)?.input?.(channel);
    closed(channel, () => {
      stops.get(channel.label)?.();
      stops.delete(channel.label);
    });
  }

  function controlChannel(channel: LineChannel, line: { opened: () => Opened | null; seen: Set<VideoTransceiver>; stops: Map<string, () => void>; heard: () => void }) {
    channel.onMessage.subscribe((raw) => {
      const control = readControl(raw.toString());
      if (!control) return;
      line.heard();
      if (control.t === "ping") send(channel, { t: "pong", at: control.at });
      const opened = line.opened();
      if (control.t !== "offer" || !opened) return;
      opened
        .renegotiate(control.sdp, screenMedia(control, line.seen, line.stops))
        .then((sdp) => send(channel, { t: "answer", sdp }))
        .catch((err: unknown) => send(channel, { t: "error", message: (err as Error).message.slice(0, ERROR_MAX) }));
    });
  }

  function refuseTerminal(channel: LineChannel) {
    channel.stateChanged.subscribe((state) => {
      if (state !== "open") return;
      send(channel, { t: "refused", message: TERMINAL_REFUSAL });
      channel.close?.();
    });
  }

  // Opens a line from a sealed offer. Only this worker can open it, and the answer goes back under the board's key.
  async function open(sealed: Sealed, run: RunHost): Promise<void> {
    const offer = readLineOffer(deps.unseal(sealed, LINE_PURPOSE));
    if (!offer) throw new Error("That line's offer is incomplete.");
    let opened: Opened | null = null;
    let lastHeard = now();
    const seen = new Set<VideoTransceiver>();
    const stops = new Map<string, () => void>();
    const quietMs = deps.quietMs ?? QUIET_MS;
    const quiet = setInterval(() => {
      if (now() - lastHeard > quietMs) line.close();
    }, quietMs / 2);
    const line = {
      close() {
        if (!lines.delete(line)) return;
        clearInterval(quiet);
        stops.forEach((stop) => stop());
        stops.clear();
        opened?.close();
      },
    };
    const channels: Channels = {
      [LINE_CHANNELS.host]: (c) => hostChannel(c, run),
      [LINE_CHANNELS.events]: eventsChannel,
      [LINE_CHANNELS.control]: (c) => controlChannel(c, { opened: () => opened, seen, stops, heard: () => (lastHeard = now()) }),
      [LINE_CHANNELS.terminal]: refuseTerminal,
      "*": (c) => screenInput(c, stops),
    };
    lines.add(line);
    if (lines.size > (deps.maxLines ?? MAX_LINES)) [...lines][0]?.close();
    try {
      opened = await (deps.answer ?? answerOffer)(offer.sdp, channels, { ice: offer.ice, media: (t) => t.forEach((x) => seen.add(x)) });
      // Pushed out by a newer line while it was answering.
      if (!lines.has(line)) {
        opened.close();
        return;
      }
      opened.onClosed(() => line.close());
      await deps.answerOn(offer.topic, await sealAnswer(offer.key, opened.answer));
      log(`Weft Worker: a board opened a line (${lines.size} open)`);
    } catch (err) {
      line.close();
      throw err;
    }
  }

  return {
    open,
    count: () => lines.size,
    closeAll: () => [...lines].forEach((line) => line.close()),
  };
}

export type HostLines = ReturnType<typeof createHostLines>;
