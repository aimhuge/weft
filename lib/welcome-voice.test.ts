import { describe, expect, it, vi } from "vitest";
import { readMuted, VoicePlayer, writeMuted } from "./welcome-voice";

// A stand-in for HTMLAudioElement, with its play and pause spies kept beside it.
function fakeAudio(src: string, play: () => Promise<void> = () => Promise.resolve()) {
  const spies = { play: vi.fn(play), pause: vi.fn() };
  const audio = { src, muted: false, play: spies.play, pause: spies.pause } as unknown as HTMLAudioElement;
  return { audio, ...spies };
}

function recorder() {
  const made: ReturnType<typeof fakeAudio>[] = [];
  const player = new VoicePlayer((src) => {
    const fake = fakeAudio(src);
    made.push(fake);
    return fake.audio;
  });
  // The nth audio the player made, which the test expects to exist.
  const nth = (i: number) => {
    const fake = made[i];
    if (!fake) throw new Error(`no audio #${i}`);
    return fake;
  };
  return { made, player, nth };
}

describe("VoicePlayer", () => {
  it("plays one track at a time, stopping the last", async () => {
    const { made, player, nth } = recorder();
    player.play("/a.m4a");
    player.play("/b.m4a");
    await Promise.resolve();
    expect(made.map((f) => f.audio.src)).toEqual(["/a.m4a", "/b.m4a"]);
    expect(nth(0).pause).toHaveBeenCalled();
    expect(nth(1).play).toHaveBeenCalled();
  });

  it("keeps a mute across tracks and applies it to the one playing", () => {
    const { player, nth } = recorder();
    player.play("/a.m4a");
    player.setMuted(true);
    expect(nth(0).audio.muted).toBe(true);
    player.play("/b.m4a");
    expect(nth(1).audio.muted).toBe(true);
    player.setMuted(false);
    expect(nth(1).audio.muted).toBe(false);
  });

  it("stays silent when autoplay is refused, and stop() is safe with nothing playing", async () => {
    const player = new VoicePlayer((src) => fakeAudio(src, () => Promise.reject(new Error("NotAllowedError"))).audio);
    player.stop();
    player.setMuted(true);
    expect(() => player.play("/a.m4a")).not.toThrow();
    await Promise.resolve();
  });

  it("makes real audio elements by default", () => {
    const Audio = vi.fn(function (this: Record<string, unknown>, src: string) {
      Object.assign(this, fakeAudio(src).audio);
    });
    vi.stubGlobal("Audio", Audio);
    new VoicePlayer().play("/a.m4a");
    expect(Audio).toHaveBeenCalledWith("/a.m4a");
    vi.unstubAllGlobals();
  });
});

describe("readMuted / writeMuted", () => {
  it("keeps the mute in localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    expect(readMuted()).toBe(false);
    writeMuted(true);
    expect(readMuted()).toBe(true);
    writeMuted(false);
    expect(readMuted()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("treats storage that throws as not muted, and ignores a failed write", () => {
    const broken = () => {
      throw new Error("SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: broken, setItem: broken, removeItem: broken });
    expect(readMuted()).toBe(false);
    expect(() => writeMuted(true)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
