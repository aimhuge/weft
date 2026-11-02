// A worker's end of the session line (docs/architecture/project-hosts.md#routes-the-webrtc-line): one peer connection
// per board that shows this worker's project, opened by a sealed `line` command and answered on the board's topic under
// its one-time key, as the screen's line is (lib/worker-rtc.ts, lib/rtc-signal.ts). On it:
//
//   host      a verb runs through `run`, the `host` kind's own path (lib/worker-kinds.ts: CardRules, remoteRefusal, the
//             update hold and the log), one at a time in the order sent, so it passes exactly the checks a row does
//   events    what the publisher ships, as it ships it (lib/worker-publish.ts mirror): one projection and one upload
//   line      ping → pong; an offer renegotiates the same peer, one at a time and rate-limited (a watched
//             simulator's track, lib/host-line-screen.ts, or an ICE restart)
//   terminal  refused, always (TERMINAL_REFUSAL): a pty is a shell, and H2 refuses a shell from the network
//
// Each fixed label gets one channel per line, and any other label is closed. A line no board has pinged for QUIET_MS is
// closed: the board went away without saying so.
import type { HostDone } from "./host-command";
import { lineScreens, type ScreenDeps } from "./host-line-screen";
import { LINE_CHANNELS, LINE_PURPOSE, TERMINAL_REFUSAL, readControl, readHostCall, readLineOffer, type HostReply, type LineEvent } from "./host-line-protocol";
import { sealAnswer, type SealedAnswer } from "./rtc-signal";
import { answerOffer, type Channel, type Channels } from "./worker-rtc";
import type { Sealed } from "./worker-seal";

export const QUIET_MS = 30_000;
// A board per Mac or two; past this the oldest line closes rather than let them pile up.
export const MAX_LINES = 4;
// Offers over a line: a screen or an ICE restart now and then, never a stream of them.
export const OFFERS_PER_WINDOW = 5;
export const OFFER_WINDOW_MS = 10_000;
const ERROR_MAX = 300;

export type LineChannel = Channel & { close?: () => void };

// A host command's payload, run as the relay runs it (lib/worker-kinds.ts line); the daemon hands it in.
export type RunHost = (payload: { verb: string; args: Record<string, unknown> }) => Promise<HostDone>;

export interface HostLineDeps extends ScreenDeps {
  unseal(sealed: Sealed, purpose: string): string;
  // Sends the sealed answer on the board's Broadcast topic (the worker's own Realtime client).
  answerOn(topic: string, sealed: SealedAnswer): Promise<unknown>;
  // What the publisher ships, as it ships it (lib/worker-publish.ts mirror): projected and uploaded once, for the rows.
  hear(listener: (event: LineEvent) => void): () => void;
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
const errorOf = (err: unknown) => (err as Error).message.slice(0, ERROR_MAX);

// Runs one task at a time, in the order they came.
function serial() {
  let queue: Promise<unknown> = Promise.resolve();
  return (task: () => Promise<unknown>) => {
    queue = queue.then(task).catch(() => {});
  };
}

export function createHostLines(deps: HostLineDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? Date.now;
  const lines = new Set<{ close: () => void }>();

  // Strictly one verb at a time, as the inbox runs rows.
  function hostChannel(channel: LineChannel, run: RunHost) {
    const next = serial();
    channel.onMessage.subscribe((raw) => {
      const call = readHostCall(raw.toString());
      if (!call) return;
      next(async () => {
        let reply: HostReply;
        try {
          const done = await run({ verb: call.verb, args: call.args });
          reply = { id: call.id, ok: true, result: done.result };
        } catch (err) {
          reply = { id: call.id, ok: false, error: errorOf(err) };
        }
        send(channel, reply);
      });
    });
  }

  function eventsChannel(channel: LineChannel) {
    closed(channel, deps.hear((event) => send(channel, event)));
  }

  type Line = { opened: () => Opened | null; screens: ReturnType<typeof lineScreens>; heard: () => void };

  function controlChannel(channel: LineChannel, line: Line) {
    const offer = serial();
    const offers: number[] = [];
    channel.onMessage.subscribe((raw) => {
      const control = readControl(raw.toString());
      if (!control) return;
      line.heard();
      if (control.t === "ping") send(channel, { t: "pong", at: control.at });
      const opened = line.opened();
      if (control.t !== "offer" || !opened) return;
      const at = now();
      while (offers.length && at - (offers[0] as number) >= OFFER_WINDOW_MS) offers.shift();
      if (offers.length >= OFFERS_PER_WINDOW) {
        send(channel, { t: "error", message: "Too many offers on this line. Wait a moment." });
        return;
      }
      offers.push(at);
      offer(() =>
        opened
          .renegotiate(control.sdp, line.screens.media(control.screen))
          .then((sdp) => send(channel, { t: "answer", sdp }))
          .catch((err: unknown) => send(channel, { t: "error", message: errorOf(err) })),
      );
    });
  }

  function refuseTerminal(channel: LineChannel) {
    channel.stateChanged.subscribe((state) => {
      if (state !== "open") return;
      send(channel, { t: "refused", message: TERMINAL_REFUSAL });
      channel.close?.();
    });
  }

  // One channel per fixed label per line: a second one with the same label is closed.
  function once(taken: Set<string>, handle: (c: LineChannel) => void) {
    return (c: LineChannel) => {
      if (taken.has(c.label)) {
        c.close?.();
        return;
      }
      taken.add(c.label);
      handle(c);
    };
  }

// Opens a line from a sealed offer. Only this worker can open it, and the answer goes back under the board's key.
  async function open(sealed: Sealed, run: RunHost): Promise<void> {
    const offer = readLineOffer(deps.unseal(sealed, LINE_PURPOSE));
    if (!offer) throw new Error("That line's offer is incomplete.");
    let opened: Opened | null = null;
    let lastHeard = now();
    const screens = lineScreens(deps);
    const taken = new Set<string>();
    const quietMs = deps.quietMs ?? QUIET_MS;
    const quiet = setInterval(() => {
      if (now() - lastHeard > quietMs) line.close();
    }, quietMs / 2);
    const line = {
      close() {
        if (!lines.delete(line)) return;
        clearInterval(quiet);
        screens.closeAll();
        opened?.close();
      },
    };
    const channels: Channels = {
      [LINE_CHANNELS.host]: once(taken, (c) => hostChannel(c, run)),
      [LINE_CHANNELS.events]: once(taken, eventsChannel),
      [LINE_CHANNELS.control]: once(taken, (c) => controlChannel(c, { opened: () => opened, screens, heard: () => (lastHeard = now()) })),
      [LINE_CHANNELS.terminal]: refuseTerminal,
      // A screen's input:<device>:<nonce>, or a label nobody handles, which is closed.
      "*": (c) => screens.input(c),
    };
    lines.add(line);
    if (lines.size > (deps.maxLines ?? MAX_LINES)) [...lines][0]?.close();
    try {
      opened = await (deps.answer ?? answerOffer)(offer.sdp, channels, { ice: offer.ice, media: screens.note });
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
