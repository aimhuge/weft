// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeWarmMic, listMics, micId, openMic, releaseMic, setMicId, WARM_MS, wiredMic } from "./mic";

type Dev = { kind: string; deviceId: string; label: string };
let devices: Dev[] = [];
const track = () => ({ readyState: "live", stop: vi.fn(function (this: { readyState: string }) { this.readyState = "ended"; }) });
const stream = () => {
  const t = track();
  return { getAudioTracks: () => [t], getTracks: () => [t], t } as unknown as MediaStream & { t: ReturnType<typeof track> };
};
const getUserMedia = vi.fn(() => Promise.resolve(stream()));

beforeEach(() => {
  vi.useFakeTimers();
  devices = [];
  getUserMedia.mockClear();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices: () => Promise.resolve(devices) },
  });
  localStorage.clear();
});
afterEach(() => {
  closeWarmMic();
  vi.useRealTimers();
});

describe("mic", () => {
  it("stores the chosen input", () => {
    expect(micId()).toBe("");
    setMicId("abc");
    expect(micId()).toBe("abc");
    setMicId("");
    expect(micId()).toBe("");
  });

  it("survives no storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("no"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("no"); });
    expect(micId()).toBe("");
    expect(() => setMicId("x")).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  it("lists inputs, skipping the default aliases and naming unlabelled ones", async () => {
    devices = [
      { kind: "audioinput", deviceId: "default", label: "Default" },
      { kind: "audioinput", deviceId: "communications", label: "C" },
      { kind: "audiooutput", deviceId: "o", label: "Speakers" },
      { kind: "audioinput", deviceId: "a", label: "" },
      { kind: "audioinput", deviceId: "b", label: "MacBook Mic" },
    ];
    expect(await listMics()).toEqual([
      { id: "a", label: "Microphone 1" },
      { id: "b", label: "MacBook Mic" },
    ]);
  });

  it("prefers a wired mic only when a Bluetooth one is around", async () => {
    devices = [{ kind: "audioinput", deviceId: "b", label: "MacBook Mic" }];
    expect(await wiredMic()).toBe("");
    devices = [
      { kind: "audioinput", deviceId: "p", label: "AirPods Pro" },
      { kind: "audioinput", deviceId: "b", label: "MacBook Mic" },
    ];
    expect(await wiredMic()).toBe("b");
    devices = [{ kind: "audioinput", deviceId: "p", label: "AirPods Pro" }];
    expect(await wiredMic()).toBe("");
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: () => Promise.reject(new Error("x")) } });
    expect(await wiredMic()).toBe("");
  });

  it("opens the chosen input and keeps it warm, then closes it", async () => {
    setMicId("b");
    const s = (await openMic()) as ReturnType<typeof stream>;
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, deviceId: { ideal: "b" } } });
    releaseMic(s);
    releaseMic(s);
    expect(await openMic()).toBe(s);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    releaseMic(s);
    vi.advanceTimersByTime(WARM_MS);
    expect(s.t.stop).toHaveBeenCalled();
    await openMic();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("opens the default when nothing is chosen, closes on release without keep, and stops strays", async () => {
    const s = await openMic();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true } });
    releaseMic(s, false);
    expect((s as ReturnType<typeof stream>).t.stop).toHaveBeenCalled();
    const stray = stream();
    releaseMic(stray);
    expect(stray.t.stop).toHaveBeenCalled();
    closeWarmMic();
  });

  it("reopens when the warm stream has died", async () => {
    const s = (await openMic()) as ReturnType<typeof stream>;
    releaseMic(s);
    expect(await openMic()).toBe(s);
    expect(await openMic()).toBe(s);
    s.t.readyState = "ended";
    await openMic();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
