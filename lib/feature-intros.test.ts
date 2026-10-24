// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  INTROS,
  INTROS_KEY,
  INTRO_TITLES,
  introEvent,
  introSrc,
  isIntro,
  loadSeenIntros,
  markIntroSeen,
  muteMessage,
  resetIntros,
} from "./feature-intros";

function memory(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[INTROS_KEY, initial]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

// A store that throws the way a blocked or full one does.
function hostile() {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

describe("the intro list", () => {
  it("names every intro it offers", () => {
    for (const id of INTROS) expect(INTRO_TITLES[id]).toBeTruthy();
  });

  it("takes only an intro it knows", () => {
    expect(isIntro("vault")).toBe(true);
    expect(isIntro("nope")).toBe(false);
    expect(isIntro(null)).toBe(false);
    expect(isIntro(7)).toBe(false);
  });
});

describe("introSrc and muteMessage", () => {
  it("plays the page live, its voice muted when you asked", () => {
    expect(introSrc("vault")).toBe("/intros/vault.html?live=1");
    expect(introSrc("vault", true)).toBe("/intros/vault.html?live=1&muted=1");
  });

  it("flips the open page's voice in the shape player.js reads", () => {
    expect(muteMessage(true)).toEqual({ weft: "intro-mute", muted: true });
  });
});

describe("introEvent", () => {
  it("reads the page's own start and done", () => {
    expect(introEvent({ weft: "intro", event: "start" })).toBe("start");
    expect(introEvent({ weft: "intro", event: "done" })).toBe("done");
    expect(introEvent({ weft: "intro", event: "pause" })).toBe("pause");
    expect(introEvent({ weft: "intro", event: "play" })).toBe("play");
  });

  it("ignores anything that isn't one of ours", () => {
    expect(introEvent(null)).toBeNull();
    expect(introEvent("intro")).toBeNull();
    expect(introEvent({ weft: "other", event: "start" })).toBeNull();
    expect(introEvent({ weft: "intro", event: "paused" })).toBeNull();
    expect(introEvent({ event: "start" })).toBeNull();
    expect(introEvent({ weft: "intro" })).toBeNull();
  });
});

describe("the seen set", () => {
  it("loads nothing from empty, broken or odd storage", () => {
    expect(loadSeenIntros(memory()).size).toBe(0);
    expect(loadSeenIntros(memory("not json")).size).toBe(0);
    expect(loadSeenIntros(memory('{"a":1}')).size).toBe(0);
    expect(loadSeenIntros(memory('["vault","nope",7]'))).toEqual(new Set(["vault"]));
  });

  it("reads storage that throws as seen nothing", () => {
    expect(loadSeenIntros(hostile()).size).toBe(0);
  });

  it("marks one seen and keeps the rest", () => {
    const store = memory();
    expect(markIntroSeen("vercel", store)).toEqual(new Set(["vercel"]));
    expect(markIntroSeen("vault", store)).toEqual(new Set(["vercel", "vault"]));
    expect(loadSeenIntros(store)).toEqual(new Set(["vercel", "vault"]));
  });

  it("still reports it seen when the write is refused", () => {
    // Storage full or blocked: it just plays again next time.
    expect(markIntroSeen("vault", hostile())).toEqual(new Set(["vault"]));
  });

  it("clears them all for Reset tips", () => {
    const store = memory(JSON.stringify(["vault"]));
    resetIntros(store);
    expect(loadSeenIntros(store).size).toBe(0);
  });

  it("survives a clear that throws", () => {
    expect(() => resetIntros(hostile())).not.toThrow();
  });
});

describe("with no localStorage", () => {
  // A board in a browser that refuses storage (private mode, blocked cookies) still has to answer: it plays again.
  function withoutStorage(read: () => unknown) {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { get: read, configurable: true });
    try {
      return loadSeenIntros();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  }

  it("treats missing storage as seen nothing", () => {
    expect(withoutStorage(() => undefined).size).toBe(0);
    expect(withoutStorage(() => memory(JSON.stringify(["vault"])))).toEqual(new Set(["vault"]));
  });

  it("treats storage that throws as seen nothing", () => {
    expect(
      withoutStorage(() => {
        throw new Error("blocked");
      }).size,
    ).toBe(0);
  });
});