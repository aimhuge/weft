import { describe, expect, it, vi } from "vitest";
import { CLEAR_AFTER_MS, copyBriefly } from "./clipboard-briefly";

function clipboard(initial = "") {
  let value = initial;
  return {
    writeText: vi.fn((t: string) => Promise.resolve(void (value = t))),
    readText: vi.fn(() => Promise.resolve(value)),
    set: (t: string) => (value = t),
    get: () => value,
  };
}

describe("copyBriefly", () => {
  it("copies, then clears the clipboard after a minute if it still holds the link", async () => {
    const c = clipboard();
    let later: () => void = () => {};
    await copyBriefly("https://sign.weft.zip/pair#s", c, (ms, fn) => {
      expect(ms).toBe(CLEAR_AFTER_MS);
      later = fn;
    });
    expect(c.get()).toBe("https://sign.weft.zip/pair#s");
    later();
    await vi.waitFor(() => expect(c.get()).toBe(""));
  });

  it("leaves something newer alone, and a clipboard it can't read", async () => {
    const c = clipboard();
    let later: () => void = () => {};
    await copyBriefly("link", c, (_ms, fn) => {
      later = fn;
    });
    c.set("newer");
    later();
    await Promise.resolve();
    await Promise.resolve();
    expect(c.get()).toBe("newer");
    c.readText.mockRejectedValueOnce(new Error("denied"));
    later();
    await Promise.resolve();
    expect(c.get()).toBe("newer");
  });

  it("uses the browser's clipboard and a real timer by default", async () => {
    vi.useFakeTimers();
    const c = clipboard();
    vi.stubGlobal("navigator", { clipboard: c });
    await copyBriefly("link");
    vi.advanceTimersByTime(CLEAR_AFTER_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(c.get()).toBe(""));
    vi.unstubAllGlobals();
  });
});
