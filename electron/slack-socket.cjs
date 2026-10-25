// Slack's Socket Mode connection (docs/architecture/slack.md): a websocket Slack opens for the app-level
// token, carrying `/weft` commands and @mentions as envelopes. Slack's rules are strict, and two of them
// matter here: an envelope must be acknowledged within a few seconds or Slack retries it, and the socket is
// told to disconnect sometimes, which is a reconnect, not an error.
//
// The ack goes first, before the envelope is handed on: an envelope Weft is slow to answer is an envelope
// Slack sends again, and a duplicate `/weft` is a second card.

const FIRST_BACKOFF = 1000;
const MAX_BACKOFF = 60_000;

/**
 * A Slack Socket Mode connection.
 * @param {object} options
 * @param {() => Promise<string>} options.open Resolves the websocket URL (apps.connections.open).
 * @param {typeof WebSocket} [options.WebSocketImpl] The websocket class (a fake in a test).
 * @param {(message: Record<string, unknown>) => void} [options.onEnvelope] Called with each envelope.
 * @param {(state: "off" | "connecting" | "connected", error?: string) => void} [options.onState] Called on every state change.
 * @param {(fn: () => void, ms: number) => unknown} [options.setTimer] The timer to wait on.
 * @param {(handle: unknown) => void} [options.clearTimer] The timer to cancel.
 */
function createSlackSocket({ open, WebSocketImpl = globalThis.WebSocket, onEnvelope = () => {}, onState = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let socket = null;
  let backoff = FIRST_BACKOFF;
  let stopped = false;
  let timer = null;

  const say = (state, error) => onState(state, error);

  function cancelTimer() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  // Wait a little longer each time, up to a minute, so a Slack outage isn't a busy loop.
  function scheduleReconnect(error) {
    if (stopped) return;
    cancelTimer();
    const wait = backoff;
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
    say("connecting", error);
    timer = setTimer(() => {
      timer = null;
      connect();
    }, wait);
  }

  function handleMessage(raw, thisSocket) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message?.type === "hello") {
      // Slack says hello once the socket is ready. The backoff resets here, so one bad afternoon
      // doesn't leave the next reconnect waiting a minute.
      backoff = FIRST_BACKOFF;
      say("connected");
      return;
    }
    if (message?.type === "disconnect") {
      // Slack is about to close this socket and wants a new one. The old socket is detached and closed
      // first: left alone, its close handler would schedule a second reconnect.
      retire(thisSocket);
      scheduleReconnect(message.reason ? `Slack asked us to reconnect: ${message.reason}` : undefined);
      return;
    }
    if (!message?.envelope_id) return;
    // The ack first, on the socket the envelope arrived on: an ack sent on another socket is an
    // envelope Slack never hears back from, and a retried `/weft` is a second card.
    try {
      thisSocket?.send(JSON.stringify({ envelope_id: message.envelope_id }));
    } catch {
      // A socket that can't be written to is closing; its own close handler reconnects.
    }
    onEnvelope(message);
  }

  // A socket Weft is done with: its handlers come off, so its close can't disturb the live one, and
  // it is closed.
  function retire(old) {
    if (!old) return;
    old.onmessage = null;
    old.onclose = null;
    old.onerror = null;
    if (socket === old) socket = null;
    try {
      old.close();
    } catch {
      // A socket that can't be closed cleanly is already gone.
    }
  }

  async function connect() {
    if (stopped) return;
    let url;
    try {
      url = await open();
    } catch (err) {
      scheduleReconnect(err?.message ? `Slack wouldn't open a connection: ${err.message}` : "Slack wouldn't open a connection.");
      return;
    }
    if (stopped) return;
    let thisSocket;
    try {
      thisSocket = new WebSocketImpl(url);
    } catch (err) {
      scheduleReconnect(err?.message ? `Slack's socket wouldn't open: ${err.message}` : "Slack's socket wouldn't open.");
      return;
    }
    // The socket this one replaces is retired first: two live sockets at once is one envelope acked on
    // the wrong one.
    retire(socket);
    socket = thisSocket;
    thisSocket.onmessage = (event) => handleMessage(event?.data, thisSocket);
    thisSocket.onclose = () => {
      // Only the live socket's close reconnects: a socket Weft already retired closing late must not
      // null the live one or queue a second reconnect.
      if (socket !== thisSocket) return;
      socket = null;
      if (!stopped) scheduleReconnect();
    };
    thisSocket.onerror = () => {
      // The close handler follows an error, and it does the reconnecting; saying "connecting" here
      // means the drawer shows the truth a moment before.
      if (socket !== thisSocket) return;
      if (!stopped) say("connecting");
    };
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    // Stop for good: no more reconnects, and the socket is told "off" so the drawer can say so.
    stop() {
      stopped = true;
      cancelTimer();
      // The handlers come off with the socket: a close that arrives after this must not reopen anything.
      retire(socket);
      say("off");
    },
  };
}

module.exports = { createSlackSocket, FIRST_BACKOFF, MAX_BACKOFF };
