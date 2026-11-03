// The board's end of a session line to one worker (docs/architecture/project-hosts.md#routes-the-webrtc-line): one
// peer connection every card on that worker shares, with `host`, `events` and `line` channels (lib/host-line-protocol.ts).
//
//   open      offer (+ the ICE servers lib/rtc-ice.ts minted) ─ sealed by this Mac's server to the worker's key ─ `line`
//             command ─ the worker answers under the one-time key on our Broadcast topic ─ DTLS, fingerprints inside
//   live      a ping every BEAT_MS on `line`; its pong is the chip's "direct · N ms"
//   repair    no pong for DEAD_MS, or ICE says disconnected: an ICE restart offered over the line itself; when that
//             can't get through, the line is dropped and opened again through Supabase, backing off (RETRY_MS)
//   media     renegotiate() adds m-lines over the line (a watched simulator's track) without another command
//
// While it isn't up the route is "relay": callers use cloud_commands and polling, as before H6.
import { gathered, offerLine, type AnswerKeys, type Listen } from "@weft/client";
import { LINE_CHANNELS, readControl, readLineEvent, type IceServer, type LineEvent, type LineOffer, type LineScreen } from "./host-line-protocol";
import { newAnswerKey, openAnswer, STUN } from "./rtc-signal";
import { createCalls, LineDown } from "./session-line-calls";

export { GATHER_MS } from "@weft/client";

export const BEAT_MS = 5_000;
export const DEAD_MS = 15_000;
export const ANSWER_MS = 15_000;
export const RENEGOTIATE_MS = 5_000;
// Each try is a command, so a network that can't connect settles at one every five minutes.
export const RETRY_MS = [5_000, 15_000, 60_000, 300_000];

export type LineRoute = { kind: "connecting" } | { kind: "direct"; ms: number | null } | { kind: "relay" };

export interface LineDeps {
  peer: (ice: IceServer[]) => RTCPeerConnection;
  ice: () => Promise<IceServer[]>;
  // Sends the sealed `line` command: this Mac's server seals it on the desktop (lib/worker-board.ts openWorkerLine);
  // weft.zip seals it in the browser and inserts the row itself (@weft/client lineOpener, lib/web-lines.ts).
  offer: (workerId: string, offer: LineOffer) => Promise<unknown>;
  // Listens on the Broadcast topic the answer comes back on (lib/line-answer.ts).
  listen: Listen;
  token: () => string;
  now?: () => number;
}

// The answer's one-time key, by Web Crypto (lib/rtc-signal.ts): the same bytes @weft/client's answerKeys makes.
const KEYS: AnswerKeys = { newKey: newAnswerKey, open: openAnswer };
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function createSessionLine(workerId: string, deps: LineDeps) {
  const now = deps.now ?? Date.now;
  const calls = createCalls();
  const events = new Set<(event: LineEvent) => void>();
  const routes = new Set<() => void>();
  let route: LineRoute = { kind: "connecting" };
  let pc: RTCPeerConnection | null = null;
  let host: RTCDataChannel | null = null;
  let control: RTCDataChannel | null = null;
  let closed = false;
  let tries = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let lastPong = 0;
  let endAttempt = () => {};
  let waiter: { resolve: (sdp: string) => void; reject: (err: Error) => void } | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let repairing = false;
  // This Mac's server refused the offer (no key published, no such worker): trying again won't help.
  let refused = false;

  const setRoute = (next: LineRoute) => {
    if (JSON.stringify(next) === JSON.stringify(route)) return;
    route = next;
    routes.forEach((fn) => fn());
  };

  function teardown() {
    clearInterval(beat);
    endAttempt();
    calls.lost();
    waiter?.reject(new LineDown());
    waiter = null;
    host = control = null;
    pc?.close();
    pc = null;
  }

  function down() {
    if (closed) return;
    teardown();
    setRoute({ kind: "relay" });
    if (!refused) retry = setTimeout(() => void connect(), RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
  }

  function onControl(raw: string) {
    const msg = readControl(raw);
    if (msg?.t === "pong") {
      lastPong = now();
      setRoute({ kind: "direct", ms: Math.max(0, now() - msg.at) });
    } else if (msg?.t === "answer") waiter?.resolve(msg.sdp);
    else if (msg?.t === "error") waiter?.reject(new Error(msg.message));
  }

  // One offer over the line at a time; the answer comes back on `line`.
  function renegotiate(add?: (pc: RTCPeerConnection) => void, screen?: LineScreen, iceRestart = false): Promise<void> {
    const run = async () => {
      const me = pc;
      const ctl = control;
      if (!me || !ctl) throw new LineDown();
      add?.(me);
      await me.setLocalDescription(await me.createOffer(iceRestart ? { iceRestart: true } : undefined));
      if (iceRestart) await gathered(me, wait);
      const answered = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The worker didn't answer over the line.")), RENEGOTIATE_MS);
        const settle = (fn: () => void) => {
          clearTimeout(timer);
          fn();
        };
        waiter = { resolve: (sdp) => settle(() => resolve(sdp)), reject: (err) => settle(() => reject(err)) };
      });
      ctl.send(JSON.stringify({ t: "offer", sdp: me.localDescription?.sdp ?? "", ...(screen ? { screen } : {}) }));
      const sdp = await answered.finally(() => (waiter = null));
      await me.setRemoteDescription({ type: "answer", sdp });
    };
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  }

  // An ICE restart offered over the line itself; when it can't get through, the line is opened again from scratch.
  function repair() {
    if (repairing) return;
    repairing = true;
    renegotiate(undefined, undefined, true)
      .then(() => void (lastPong = now()), down)
      .finally(() => (repairing = false));
  }

  function opened(me: RTCPeerConnection) {
    if (pc !== me || !host || !control) return;
    endAttempt();
    tries = 0;
    lastPong = now();
    setRoute({ kind: "direct", ms: null });
    const ctl = control;
    beat = setInterval(() => {
      if (now() - lastPong > DEAD_MS) repair();
      else ctl.send(JSON.stringify({ t: "ping", at: now() }));
    }, BEAT_MS);
  }

  function channels(me: RTCPeerConnection) {
    const make = (label: string) => me.createDataChannel(label, { ordered: true });
    const h = make(LINE_CHANNELS.host);
    const ev = make(LINE_CHANNELS.events);
    const ctl = make(LINE_CHANNELS.control);
    h.onmessage = (e: MessageEvent) => calls.reply(String(e.data));
    ev.onmessage = (e: MessageEvent) => {
      const event = readLineEvent(String(e.data));
      if (event) events.forEach((fn) => fn(event));
    };
    ctl.onmessage = (e: MessageEvent) => onControl(String(e.data));
    h.onopen = () => {
      host = h;
      opened(me);
    };
    ctl.onopen = () => {
      control = ctl;
      opened(me);
    };
    h.onclose = ctl.onclose = () => {
      if (pc === me) down();
    };
  }

  async function connect() {
    const ice = await deps.ice().catch(() => [{ urls: STUN }]);
    if (closed) return;
    const me = (pc = deps.peer(ice));
    channels(me);
    me.addEventListener("connectionstatechange", () => {
      if (pc !== me) return;
      if (me.connectionState === "failed" || me.connectionState === "closed") down();
      else if (me.connectionState === "disconnected") repair();
    });
    // The offer and the answer's listener are @weft/client's, the phone's too: a forged or stale answer fails to open and
    // is dropped, and the attempt then times out to the relay.
    const { offer, stop } = await offerLine(me, ice, { keys: KEYS, listen: deps.listen, token: deps.token, wait, current: () => pc === me });
    const giveUp = setTimeout(() => pc === me && down(), ANSWER_MS);
    endAttempt = () => {
      clearTimeout(giveUp);
      stop();
      endAttempt = () => {};
    };
    await deps.offer(workerId, offer).catch((err: unknown) => {
      refused = true;
      throw err;
    });
  }

  void connect().catch(() => down());

  return {
    workerId,
    route: () => route,
    up: () => host?.readyState === "open",
    call: (verb: string, args: Record<string, unknown>) => {
      const h = host?.readyState === "open" ? host : null;
      return calls.call(h && ((text: string) => h.send(text)), verb, args);
    },
    renegotiate: (add: (pc: RTCPeerConnection) => void, screen?: LineScreen) => renegotiate(add, screen),
    // One more channel on the live connection (the terminal's): no renegotiation, since SCTP is already up. Null while
    // the line isn't up; it closes when the line drops.
    channel: (label: string) => (pc && host?.readyState === "open" ? pc.createDataChannel(label, { ordered: true }) : null),
    onEvent(fn: (event: LineEvent) => void) {
      events.add(fn);
      return () => void events.delete(fn);
    },
    onRoute(fn: () => void) {
      routes.add(fn);
      return () => void routes.delete(fn);
    },
    close() {
      closed = true;
      clearTimeout(retry);
      teardown();
      setRoute({ kind: "relay" });
    },
  };
}

export type SessionLine = ReturnType<typeof createSessionLine>;
