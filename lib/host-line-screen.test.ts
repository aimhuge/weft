// A watched simulator on a worker's session line (lib/host-line-screen.ts): the relay input kind's own-card check, a
// well-formed channel, one track per device, and the channel's closing stopping it.
import { describe, expect, it, vi } from "vitest";
import { lineScreens } from "./host-line-screen";
import type { Card } from "./types";

function emitter() {
  const subs: ((v: string) => void)[] = [];
  return { subscribe: (fn: (v: string) => void) => subs.push(fn), emit: (v: string) => subs.forEach((fn) => fn(v)) };
}
type Fake = Parameters<ReturnType<typeof lineScreens>["input"]>[0] & { close: ReturnType<typeof vi.fn>; stateChanged: ReturnType<typeof emitter> };
const channel = (label: string) => ({ label, close: vi.fn(), stateChanged: emitter(), onMessage: emitter(), send: vi.fn(), bufferedAmount: 0 }) as unknown as Fake;
const own = { id: "c1" } as Card;

function setup(watcher: Card | null = own) {
  const stops = [vi.fn(), vi.fn(), vi.fn()];
  let n = 0;
  const fast = { attach: vi.fn(() => stops[n++] ?? null), input: vi.fn() };
  const screens = lineScreens({ screen: (d) => (d === "sim" ? (fast as never) : null), watcher: () => watcher ?? undefined });
  return { screens, fast, stops };
}

const video = () => ({ kind: "video" }) as never;

describe("lineScreens", () => {
  it("sends only on new m-lines, one track per device, stopped by its own channel closing", () => {
    const { screens, fast, stops } = setup();
    const old = video();
    screens.note([old]);
    const fresh = video();
    screens.media({ device: "sim", quality: "low", channel: "input:sim:0123abcd" })([old, fresh]);
    expect(fast.attach).toHaveBeenCalledWith([fresh], "low");
    screens.media({ device: "sim", channel: "input:sim:4567abcd" })([video()]);
    expect(stops[0]).toHaveBeenCalled();
    // The first channel closing doesn't stop the track that replaced it; its own does.
    const first = channel("input:sim:0123abcd");
    screens.input(first);
    first.stateChanged.emit("closed");
    expect(stops[1]).not.toHaveBeenCalled();
    const second = channel("input:sim:4567abcd");
    screens.input(second);
    expect(fast.input).toHaveBeenCalledWith(second);
    second.stateChanged.emit("open");
    second.stateChanged.emit("closed");
    expect(stops[1]).toHaveBeenCalled();
    second.stateChanged.emit("closed");
    screens.closeAll();
  });

  it("stops every track when the line closes", () => {
    const { screens, stops } = setup();
    screens.media({ device: "sim", channel: "input:sim:0123abcd" })([video()]);
    screens.closeAll();
    expect(stops[0]).toHaveBeenCalled();
  });

  it("carries nothing without a well-formed channel for the same device, or for a card that isn't its own", () => {
    for (const screen of [undefined, { device: "sim" }, { device: "sim", channel: "input:sim:xyz" }, { device: "sim", channel: "input:other:0123abcd" }]) {
      const { screens, fast } = setup();
      screens.media(screen)([video()]);
      expect(fast.attach).not.toHaveBeenCalled();
    }
    for (const watcher of [null, { id: "co", role: "copilot" } as Card]) {
      const { screens, fast } = setup(watcher);
      screens.media({ device: "sim", channel: "input:sim:0123abcd" })([video()]);
      expect(fast.attach).not.toHaveBeenCalled();
      const c = channel("input:sim:0123abcd");
      screens.input(c);
      expect(c.close).toHaveBeenCalled();
    }
  });

  it("closes an input channel for a device it doesn't watch, a malformed label, or a screen with no input", () => {
    const { screens } = setup();
    for (const label of ["input:other:0123abcd", "input:sim", "host2"]) {
      const c = channel(label);
      screens.input(c);
      expect(c.close).toHaveBeenCalled();
    }
    const bare = lineScreens({ screen: () => ({ attach: () => null }) as never, watcher: () => own });
    const c = channel("input:sim:0123abcd");
    bare.input(c);
    expect(c.close).toHaveBeenCalled();
    bare.media({ device: "sim", channel: "input:sim:0123abcd" })([video()]);
    const none = lineScreens({});
    none.input(channel("input:sim:0123abcd"));
    none.media({ device: "sim", channel: "input:sim:0123abcd" })([video()]);
  });
});
