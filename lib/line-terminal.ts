"use client";

// The terminal drawer on a worker's project (docs/architecture/project-hosts.md#signed-widening-as-built): the same
// bridge shape as this Mac's shells (window.weft.terminal, electron/terminal.cjs), over the worker's session line. Each
// shell is a `terminal` channel opened with a Touch ID approval for that project folder (lib/widen-signer.ts); the
// worker runs a pty there only once the approval checks out (lib/host-line-terminal.ts). Nothing goes by the relay:
// with no direct line there's no terminal. The shell ends when its channel or the line closes.
import type { ShellBridge } from "./client-bridge";
import { LINE_CHANNELS, readTerminalOut, type TerminalIn } from "./host-line-protocol";
import { lineFor } from "./session-lines";
import { signWiden } from "./widen-signer";
import { parseWorkerProject } from "./worker-project";

export type TerminalBridge = ShellBridge["terminal"];

export const NO_LINE = "The terminal needs the direct line to this worker, and it's on the relay now. Try again once the chip says direct.";
export const ONE_AT_A_TIME = "One terminal per worker for now: close the other one first.";

type Session = { channel: RTCDataChannel; exited: boolean };

export function lineTerminalBridge(workerId: string): TerminalBridge {
  const sessions = new Map<string, Session>();
  const data = new Set<(id: string, data: string) => void>();
  const exits = new Set<(id: string, code: number) => void>();
  const send = (s: Session, msg: TerminalIn) => s.channel.readyState === "open" && s.channel.send(JSON.stringify(msg));
  const exit = (id: string, code: number) => {
    const s = sessions.get(id);
    if (!s || s.exited) return;
    s.exited = true;
    sessions.delete(id);
    exits.forEach((fn) => fn(id, code));
  };

  async function open(id: string, cwd: string, cols: number, rows: number) {
    const folder = parseWorkerProject(cwd)?.folder;
    if (!folder) return { error: "That isn't a worker's project." };
    if ([...sessions.values()].some((s) => !s.exited)) return { error: ONE_AT_A_TIME };
    if (!lineFor(workerId)?.up()) return { error: NO_LINE };
    let widen: unknown;
    try {
      widen = await signWiden({ host: workerId, card: "", verb: "terminal.open", change: { terminal: folder }, args: {} });
    } catch (err) {
      return { error: (err as Error).message };
    }
    const channel = lineFor(workerId)?.channel(LINE_CHANNELS.terminal);
    if (!channel) return { error: NO_LINE };
    const session: Session = { channel, exited: false };
    sessions.set(id, session);
    return new Promise<{ error?: string }>((resolve) => {
      channel.onopen = () => send(session, { t: "open", folder, cols, rows, widen });
      channel.onclose = () => {
        resolve({ error: "The line closed before the terminal opened." });
        exit(id, -1);
      };
      channel.onmessage = (e: MessageEvent) => {
        const msg = readTerminalOut(String(e.data));
        if (msg?.t === "opened") resolve({});
        else if (msg?.t === "refused") {
          resolve({ error: msg.message });
          exit(id, -1);
        } else if (msg?.t === "data") data.forEach((fn) => fn(id, msg.data));
        else if (msg?.t === "exit") exit(id, msg.code);
      };
    });
  }

  return {
    open,
    write: (id, text) => {
      const s = sessions.get(id);
      if (s) send(s, { t: "input", data: text });
    },
    resize: (id, cols, rows) => {
      const s = sessions.get(id);
      if (s) send(s, { t: "resize", cols, rows });
    },
    kill: (id) => {
      sessions.get(id)?.channel.close();
      exit(id, 0);
    },
    onData: (fn) => {
      data.add(fn);
      return () => void data.delete(fn);
    },
    onExit: (fn) => {
      exits.add(fn);
      return () => void exits.delete(fn);
    },
  };
}

const bridges = new Map<string, TerminalBridge>();

// The terminal bridge for a folder: this Mac's shells, or a worker project's over its line.
export function terminalBridgeFor(cwd: string, local: TerminalBridge | undefined): TerminalBridge | undefined {
  const worker = parseWorkerProject(cwd)?.workerId;
  if (!worker) return local;
  let b = bridges.get(worker);
  if (!b) bridges.set(worker, (b = lineTerminalBridge(worker)));
  return b;
}
