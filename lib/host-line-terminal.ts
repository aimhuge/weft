// A worker's terminal over the session line (docs/architecture/project-hosts.md#signed-widening-as-built): a pty in
// one of its project folders, opened only by a signed approval for exactly that folder (lib/widen-check.ts, verb
// terminal.open), and only ever on the line's `terminal` channel: never the relay, whose rows are 4 KB and stored.
// It closes when the channel closes, and the channel closes with the line, so a dropped line takes the shell with it.
import { readTerminalIn, TERMINAL_REFUSAL, type TerminalOut } from "./host-line-protocol";
import type { Channel } from "./worker-rtc";

// A pseudo-terminal, as node-pty gives one (lib/worker-pty.ts).
export interface Pty {
  onData(listener: (data: string) => void): void;
  onExit(listener: (code: number) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface TerminalDeps {
  // The folder's checkout once the approval checks out; throws the refusal otherwise.
  allow(folder: string, auth: unknown): Promise<string>;
  spawn(cwd: string, cols: number, rows: number): Pty;
}

// What one data message carries at most: a DataChannel message stays well under every peer's limit.
export const CHUNK = 16_000;

type TermChannel = Channel & { close?: () => void };

const send = (channel: TermChannel, message: TerminalOut) => channel.send(JSON.stringify(message));

// Handles one `terminal` channel: the first message must open it; anything before or after a refusal is dropped.
// Returns the shell's stop, which the line calls when it closes.
export function terminalChannel(channel: TermChannel, deps: TerminalDeps | undefined, log: (msg: string) => void = () => {}) {
  let pty: Pty | null = null;
  let state: "waiting" | "opening" | "open" | "done" = "waiting";
  // Read through a call: the open below checks it after an await, once the channel may have closed.
  const current = () => state;
  const stop = () => {
    state = "done";
    pty?.kill();
    pty = null;
  };
  const refuse = (message: string) => {
    send(channel, { t: "refused", message: message.slice(0, 300) });
    stop();
    channel.close?.();
  };

  async function open(using: TerminalDeps, folder: string, cols: number, rows: number, auth: unknown) {
    state = "opening";
    try {
      const cwd = await using.allow(folder, auth);
      if (current() !== "opening") return;
      const shell = (pty = using.spawn(cwd, cols, rows));
      shell.onData((data) => {
        for (let at = 0; at < data.length; at += CHUNK) send(channel, { t: "data", data: data.slice(at, at + CHUNK) });
      });
      shell.onExit((code) => {
        if (state === "done") return;
        send(channel, { t: "exit", code });
        stop();
      });
      state = "open";
      send(channel, { t: "opened" });
      log(`Weft Worker: a terminal opened in ${folder} over a line`);
    } catch (err) {
      refuse((err as Error).message);
    }
  }

  // A worker with no terminal says so as soon as the channel opens, as before signed widening.
  if (!deps) {
    channel.stateChanged.subscribe((s) => {
      if (s === "open") refuse(TERMINAL_REFUSAL);
    });
    return stop;
  }
  channel.onMessage.subscribe((raw) => {
    const msg = readTerminalIn(raw.toString());
    if (!msg || state === "done") return;
    if (state === "waiting") {
      if (msg.t === "open") void open(deps, msg.folder, msg.cols, msg.rows, msg.widen);
      else refuse(TERMINAL_REFUSAL);
      return;
    }
    if (state !== "open" || !pty) return;
    if (msg.t === "input") pty.write(msg.data);
    else if (msg.t === "resize") pty.resize(msg.cols, msg.rows);
  });
  channel.stateChanged.subscribe((s) => {
    if (s === "closed") stop();
  });
  return stop;
}
