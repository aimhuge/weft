import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "./simulator-devices";

const sim = vi.hoisted(() => ({ frameJpeg: vi.fn(), markLive: vi.fn(), watch: vi.fn(), watching: vi.fn() }));
const notePage = vi.hoisted(() => vi.fn());
vi.mock("./simulator-watch", () => ({ ...sim, WATCH_MS: 600_000 }));
vi.mock("./card-page", () => ({ notePage }));

const { nudgeScreen, openScreenChannel, pump, screenOnWorker, setScreenChannel } = await import("./worker-screen");
const { paneFromUrl, screenTopic } = await import("./share-types");

const d: Device = { id: "udid-1", name: "iPhone 17", platform: "ios", state: "booted" };

beforeEach(() => {
  vi.clearAllMocks();
  setScreenChannel(null);
});

describe("pump", () => {
  it("sends a changed frame, skips a still one, and resends after a while", async () => {
    let clock = 0;
    const frames = ["a", "a", "b", "b"];
    sim.watching.mockImplementation(() => frames.length > 0);
    sim.frameJpeg.mockImplementation(() => Promise.resolve(Buffer.from(frames.shift() ?? "")));
    const send = vi.fn(() => Promise.resolve());
    await pump(d, { send, close: vi.fn() }, () => clock, (ms) => ((clock += ms), Promise.resolve()));
    expect(send).toHaveBeenCalledTimes(2);
    sim.watching.mockReset();

    const again = ["a", "a"];
    clock = 0;
    sim.watching.mockImplementation(() => again.length > 0);
    sim.frameJpeg.mockImplementation(() => Promise.resolve(Buffer.from(again.shift() ?? "")));
    const later = vi.fn(() => Promise.resolve());
    await pump(d, { send: later, close: vi.fn() }, () => clock, (ms) => ((clock += 5_000 + ms), Promise.resolve()));
    expect(later).toHaveBeenCalledTimes(2);
  });

  it("carries on past a bad capture", async () => {
    let passes = 2;
    sim.watching.mockImplementation(() => passes-- > 0);
    sim.frameJpeg.mockRejectedValueOnce(new Error("mid boot")).mockResolvedValueOnce(Buffer.from("x"));
    const send = vi.fn(() => Promise.resolve());
    await pump(d, { send, close: vi.fn() }, () => 0, () => Promise.resolve());
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("nudgeScreen", () => {
  it("captures now instead of waiting out the tick", async () => {
    let passes = 2;
    sim.watching.mockImplementation(() => passes-- > 0);
    sim.frameJpeg.mockResolvedValue(Buffer.from("x"));
    const done = pump(d, { send: () => Promise.resolve(), close: vi.fn() }, () => 0, () => new Promise(() => {}));
    await vi.waitFor(() => expect(sim.frameJpeg).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      nudgeScreen("udid-1");
      expect(sim.frameJpeg).toHaveBeenCalledTimes(2);
    });
    nudgeScreen("udid-1");
    await done;
  });

  it("does nothing for a device with no stream", () => {
    expect(nudgeScreen("nobody")).toBeUndefined();
  });
});

describe("screenOnWorker", () => {
  it("says so on a worker without the channel", async () => {
    await expect(screenOnWorker("c", d)).rejects.toThrow("Update it");
  });

  it("puts a screen page on the card and reuses its topic on a second watch", async () => {
    let live = true;
    sim.watching.mockImplementation(() => live);
    sim.frameJpeg.mockResolvedValue(Buffer.from("x"));
    const close = vi.fn();
    const open = vi.fn(() => Promise.resolve({ send: () => Promise.resolve(), close }));
    setScreenChannel(open);
    await screenOnWorker("c", d, () => 1_000);
    await screenOnWorker("c", d, () => 2_000);
    expect(open).toHaveBeenCalledTimes(1);
    expect(sim.markLive).toHaveBeenCalledWith("udid-1");
    const pane = paneFromUrl(notePage.mock.calls[1]?.[1] as string);
    expect(pane).toMatchObject({ kind: "screen", device: "udid-1", label: "iPhone 17", until: 602_000 });
    expect(open).toHaveBeenCalledWith(screenTopic((pane as { token: string }).token));
    live = false;
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
  });
});

describe("openScreenChannel", () => {
  const client = (status: string, err?: Error) => {
    const send = vi.fn(() => Promise.resolve());
    const removeChannel = vi.fn(() => Promise.resolve());
    const channel = { send, subscribe: (cb: (s: string, e?: Error) => void) => status && cb(status, err) };
    return { send, removeChannel, client: { channel: () => channel, removeChannel } };
  };

  it("resolves joined and sends frames on the event", async () => {
    const c = client("SUBSCRIBED");
    const channel = await openScreenChannel(c.client, "t");
    await channel.send("jpg");
    expect(c.send).toHaveBeenCalledWith({ type: "broadcast", event: "frame", payload: { jpg: "jpg" } });
    channel.close();
    expect(c.removeChannel).toHaveBeenCalled();
  });

  it("rejects a failed join, with and without a reason, and a join that never answers", async () => {
    await expect(openScreenChannel(client("CHANNEL_ERROR", new Error("nope")).client, "t")).rejects.toThrow("nope");
    await expect(openScreenChannel(client("TIMED_OUT").client, "t")).rejects.toThrow("channel.");
    await expect(openScreenChannel(client("").client, "t", 1)).rejects.toThrow("channel.");
  });
});
