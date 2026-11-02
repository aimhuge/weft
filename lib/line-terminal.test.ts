// The terminal drawer on a worker's project (lib/line-terminal.ts): a Touch ID approval, then a `terminal` channel on the
// worker's line that carries the shell, and nothing when the line isn't direct.
import { beforeEach, describe, expect, it, vi } from "vitest";

const sign = vi.hoisted(() => vi.fn(() => Promise.resolve({ kind: "ed25519" })));
vi.mock("./widen-signer", () => ({ signWiden: sign }));
const state = vi.hoisted(() => ({ up: true, channel: null as null | FakeChannel, make: true }));
vi.mock("./session-lines", () => ({
  lineFor: () => ({ up: () => state.up, channel: () => (state.make ? (state.channel = fake()) : null) }),
}));

type FakeChannel = ReturnType<typeof fake>;
function fake() {
  const c = {
    readyState: "connecting",
    sent: [] as Record<string, unknown>[],
    onopen: null as null | (() => void),
    onclose: null as null | (() => void),
    onmessage: null as null | ((e: { data: string }) => void),
    send: (t: string) => c.sent.push(JSON.parse(t) as Record<string, unknown>),
    close: vi.fn(),
    open() {
      c.readyState = "open";
      c.onopen?.();
    },
    say: (m: unknown) => c.onmessage?.({ data: JSON.stringify(m) }),
  };
  return c;
}

const { lineTerminalBridge, terminalBridgeFor, NO_LINE, ONE_AT_A_TIME } = await import("./line-terminal");
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  state.up = true;
  state.make = true;
  state.channel = null;
  sign.mockClear();
});

describe("lineTerminalBridge", () => {
  it("opens a shell with an approval for the project folder and carries it both ways", async () => {
    const b = lineTerminalBridge("w1");
    const data: string[] = [];
    const exits: number[] = [];
    const offData = b.onData((id, d) => data.push(`${id}:${d}`));
    const offExit = b.onExit((id, code) => exits.push(code));
    const opening = b.open("t1", "worker://w1/app", 80, 24);
    await flush();
    expect(sign).toHaveBeenCalledWith({ host: "w1", card: "", verb: "terminal.open", change: { terminal: "app" }, args: {} });
    const ch = state.channel as FakeChannel;
    ch.open();
    expect(ch.sent).toEqual([{ t: "open", folder: "app", cols: 80, rows: 24, widen: { kind: "ed25519" } }]);
    ch.say({ t: "opened" });
    await expect(opening).resolves.toEqual({});
    ch.say({ t: "data", data: "hi" });
    ch.onmessage?.({ data: "junk" });
    b.write("t1", "ls\r");
    b.resize("t1", 100, 30);
    b.write("other", "x");
    b.resize("other", 1, 1);
    expect(ch.sent.slice(1)).toEqual([{ t: "input", data: "ls\r" }, { t: "resize", cols: 100, rows: 30 }]);
    expect(data).toEqual(["t1:hi"]);
    expect(await b.open("t2", "worker://w1/app", 80, 24)).toEqual({ error: ONE_AT_A_TIME });
    ch.say({ t: "exit", code: 0 });
    ch.say({ t: "exit", code: 1 });
    expect(exits).toEqual([0]);
    offData();
    offExit();
  });

  it("says why it can't open: not a worker path, no direct line, no approval, refused, or the line went", async () => {
    const b = lineTerminalBridge("w1");
    expect(await b.open("t", "/local", 80, 24)).toEqual({ error: "That isn't a worker's project." });
    state.up = false;
    expect(await b.open("t", "worker://w1/app", 80, 24)).toEqual({ error: NO_LINE });
    state.up = true;
    sign.mockRejectedValueOnce(new Error("Not approved"));
    expect(await b.open("t", "worker://w1/app", 80, 24)).toEqual({ error: "Not approved" });
    state.make = false;
    expect(await b.open("t", "worker://w1/app", 80, 24)).toEqual({ error: NO_LINE });
    state.make = true;
    const refused = b.open("t", "worker://w1/app", 80, 24);
    await flush();
    state.channel?.say({ t: "refused", message: "stale" });
    expect(await refused).toEqual({ error: "stale" });
    const dropped = b.open("t", "worker://w1/app", 80, 24);
    await flush();
    state.channel?.onclose?.();
    expect(await dropped).toEqual({ error: "The line closed before the terminal opened." });
  });

  it("kills a shell by closing its channel, and sends nothing on a channel that isn't open", async () => {
    const b = lineTerminalBridge("w1");
    const exits: number[] = [];
    b.onExit((_, code) => exits.push(code));
    void b.open("t1", "worker://w1/app", 80, 24);
    await flush();
    const ch = state.channel as FakeChannel;
    b.write("t1", "early");
    expect(ch.sent).toEqual([]);
    b.kill("t1");
    expect(ch.close).toHaveBeenCalled();
    expect(exits).toEqual([0]);
    b.kill("t1");
  });
});

describe("terminalBridgeFor", () => {
  it("gives this Mac's shells for a local folder and one line bridge per worker", () => {
    const local = { open: vi.fn() } as never;
    expect(terminalBridgeFor("/Users/me/app", local)).toBe(local);
    const a = terminalBridgeFor("worker://w1/app", local);
    expect(a).not.toBe(local);
    expect(terminalBridgeFor("worker://w1/site", undefined)).toBe(a);
  });
});
