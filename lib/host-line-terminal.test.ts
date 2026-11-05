import { describe, expect, it, vi } from "vitest";
import { TERMINAL_REFUSAL } from "./host-line-protocol";
import { CHUNK, terminalChannel, type Pty, type TerminalDeps } from "./host-line-terminal";

function emitter<T>() {
  const subs: ((v: T) => void)[] = [];
  return { subscribe: (fn: (v: T) => void) => subs.push(fn), emit: (v: T) => subs.forEach((fn) => fn(v)) };
}

function channel() {
  const sent: Record<string, unknown>[] = [];
  const c = { label: "terminal", bufferedAmount: 0, send: (t: string) => sent.push(JSON.parse(t) as Record<string, unknown>), onMessage: emitter<string>(), stateChanged: emitter<string>(), close: vi.fn() };
  return { c: c as never, raw: c, sent, msg: (v: unknown) => c.onMessage.emit(typeof v === "string" ? v : JSON.stringify(v)), state: (s: string) => c.stateChanged.emit(s) };
}

function pty() {
  let data: (d: string) => void = () => {};
  let exit: (c: number) => void = () => {};
  const p = { onData: (fn: typeof data) => void (data = fn), onExit: (fn: typeof exit) => void (exit = fn), write: vi.fn(), resize: vi.fn(), kill: vi.fn() } satisfies Pty;
  return { p, data: (d: string) => data(d), exit: (c: number) => exit(c) };
}

const open = { t: "open", folder: "app", cols: 80, rows: 24, widen: { k: 1 } };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("terminalChannel", () => {
  it("refuses as soon as it opens on a worker with no terminal", () => {
    const ch = channel();
    terminalChannel(ch.c, undefined);
    ch.state("connecting");
    expect(ch.sent).toEqual([]);
    ch.state("open");
    expect(ch.sent).toEqual([{ t: "refused", message: TERMINAL_REFUSAL }]);
    expect(ch.raw.close).toHaveBeenCalled();
  });

  it("opens a pty in the approved folder, carries input, resizes and output in chunks, and says when it exits", async () => {
    const ch = channel();
    const shell = pty();
    const allow = vi.fn(() => Promise.resolve("/w/app"));
    const spawn = vi.fn(() => shell.p);
    const deps: TerminalDeps = { allow, spawn };
    const log = vi.fn();
    terminalChannel(ch.c, deps, log);
    ch.msg("not json");
    ch.msg(open);
    await flush();
    expect(allow).toHaveBeenCalledWith("app", { k: 1 });
    expect(spawn).toHaveBeenCalledWith("/w/app", 80, 24);
    expect(ch.sent).toEqual([{ t: "opened" }]);
    expect(log).toHaveBeenCalled();
    ch.msg({ t: "input", data: "ls\r" });
    ch.msg({ t: "resize", cols: 100, rows: 30 });
    ch.msg(open);
    expect(shell.p.write).toHaveBeenCalledWith("ls\r");
    expect(shell.p.resize).toHaveBeenCalledWith(100, 30);
    shell.data("x".repeat(CHUNK + 5));
    expect(ch.sent.slice(1).map((m) => (m.data as string).length)).toEqual([CHUNK, 5]);
    shell.exit(0);
    expect(ch.sent.at(-1)).toEqual({ t: "exit", code: 0 });
    shell.exit(1);
    ch.msg({ t: "input", data: "after" });
    expect(shell.p.write).toHaveBeenCalledTimes(1);
  });

  it("refuses a first message that isn't an open, and an approval that doesn't check out", async () => {
    const first = channel();
    terminalChannel(first.c, { allow: vi.fn(), spawn: vi.fn() });
    first.msg({ t: "input", data: "x" });
    expect(first.sent).toEqual([{ t: "refused", message: TERMINAL_REFUSAL }]);
    const bad = channel();
    const spawn = vi.fn();
    terminalChannel(bad.c, { allow: () => Promise.reject(new Error("stale")), spawn });
    bad.msg(open);
    await flush();
    expect(bad.sent).toEqual([{ t: "refused", message: "stale" }]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("kills the shell when the channel closes, and never starts one whose channel closed while it was checked", async () => {
    const ch = channel();
    const shell = pty();
    const stop = terminalChannel(ch.c, { allow: () => Promise.resolve("/w"), spawn: () => shell.p });
    ch.msg(open);
    await flush();
    ch.state("open");
    ch.state("closed");
    expect(shell.p.kill).toHaveBeenCalled();
    stop();
    const late = channel();
    const spawn = vi.fn();
    let release: (v: string) => void = () => {};
    terminalChannel(late.c, { allow: () => new Promise<string>((r) => (release = r)), spawn });
    late.msg(open);
    late.msg({ t: "input", data: "early" });
    late.state("closed");
    release("/w");
    await flush();
    expect(spawn).not.toHaveBeenCalled();
  });
});
