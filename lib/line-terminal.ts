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

export const noLine = (name: string) => `The direct line to ${name} is down, so its terminal can't open. Try again once the chip says direct.`;
export const tooOld = (name: string) => `${name} needs to update before its terminal works here.`;
export const ONE_AT_A_TIME = "One terminal per worker for now: close the other one first.";
// What a worker from before signed widening says on every terminal channel. It isn't "go to the box": that worker
// can't check an approval at all, so the answer is to update it.
export const LEGACY_REFUSAL =
  "A terminal on a worker only opens from Weft's own window on its Mac, and a line can't prove it was opened there yet. Open the card's terminal on the worker itself.";

type Session = { channel: RTCDataChannel; exited: boolean };

// `nameOf` gives the worker's name for the messages ("m1mini needs to update…"), read when a shell opens.
export function lineTerminalBridge(workerId: string, nameOf: () => string = () => "this worker"): TerminalBridge {
  const sessions = new Map<string, Session>();
  const data = new Set<(id: string, data: string) => void>();
  const exits = new Set<(id: string, code: number) => void>();
  const send = (s: Session, msg: TerminalIn) => s.channel.readyState === "open" && s.channel.send(JSON.stringify(msg));
  // A shell that never opened only leaves: no exit code, so the drawer shows the one reason it gave, not "exited (-1)".
  const drop = (id: string) => {
    const s = sessions.get(id);
    if (s) s.exited = true;
    sessions.delete(id);
  };
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
    if (!lineFor(workerId)?.up()) return { error: noLine(nameOf()) };
    let widen: unknown;
    try {
      widen = await signWiden({ host: workerId, card: "", verb: "terminal.open", change: { terminal: folder }, args: {} });
    } catch (err) {
      return { error: (err as Error).message };
    }
    const channel = lineFor(workerId)?.channel(LINE_CHANNELS.terminal);
    if (!channel) return { error: noLine(nameOf()) };
    const session: Session = { channel, exited: false };
    sessions.set(id, session);
    let opened = false;
    return new Promise<{ error?: string }>((resolve) => {
      channel.onopen = () => send(session, { t: "open", folder, cols, rows, widen });
      channel.onclose = () => {
        if (opened) {
          exit(id, -1);
          return;
        }
        resolve({ error: `The line to ${nameOf()} closed before the terminal opened.` });
        drop(id);
      };
      channel.onmessage = (e: MessageEvent) => {
        const msg = readTerminalOut(String(e.data));
        if (msg?.t === "opened") {
          opened = true;
          resolve({});
        } else if (msg?.t === "refused") {
          resolve({ error: msg.message === LEGACY_REFUSAL ? tooOld(nameOf()) : msg.message });
          if (opened) exit(id, -1);
          else drop(id);
          channel.close();
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
const names = new Map<string, string>();

// The terminal bridge for a folder: this Mac's shells, or a worker project's over its line. `name` is the worker's, for
// what the drawer says when its terminal can't open.
export function terminalBridgeFor(cwd: string, local: TerminalBridge | undefined, name?: string | null): TerminalBridge | undefined {
  const worker = parseWorkerProject(cwd)?.workerId;
  if (!worker) return local;
  if (name) names.set(worker, name);
  let b = bridges.get(worker);
  if (!b) bridges.set(worker, (b = lineTerminalBridge(worker, () => names.get(worker) ?? "this worker")));
  return b;
}
