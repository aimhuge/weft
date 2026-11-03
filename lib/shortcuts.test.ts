// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellBridge } from "./client";
import {
  bindingAccelerator,
  bindingFromEvent,
  bindingSpec,
  currentBinding,
  formatBinding,
  matches,
  setBinding,
  SHORTCUTS,
  syncDictationShortcut,
  type Binding,
} from "./shortcuts";

const STORAGE_KEY = "threadboard.shortcuts";

function bind(code: string, mods: Partial<Omit<Binding, "code">> = {}): Binding {
  return { code, alt: false, ctrl: false, meta: false, shift: false, ...mods };
}

function press(code: string, mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) {
  return new KeyboardEvent("keydown", { code, ...mods });
}

function onMac(mac: boolean) {
  vi.stubGlobal("navigator", { userAgent: mac ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)" : "Mozilla/5.0 (Windows NT 10.0)" });
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("currentBinding and setBinding", () => {
  it("defaults dictation to Option+'", () => {
    expect(SHORTCUTS.map((s) => s.id)).toEqual(["dictation"]);
    expect(currentBinding("dictation")).toEqual(bind("Quote", { alt: true }));
  });

  it("saves a binding and puts the default back for null", () => {
    setBinding("dictation", bind("KeyD", { meta: true, shift: true }));
    expect(currentBinding("dictation")).toEqual(bind("KeyD", { meta: true, shift: true }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toHaveProperty("dictation");
    setBinding("dictation", null);
    expect(currentBinding("dictation")).toEqual(bind("Quote", { alt: true }));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({});
  });

  it("is undefined for an id with no default and nothing saved", () => {
    expect(currentBinding("nope")).toBeUndefined();
  });

  it("falls back to the defaults when storage holds junk", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(currentBinding("dictation")).toEqual(bind("Quote", { alt: true }));
  });

  it("doesn't throw when storage refuses the write", () => {
    const setItem = vi.fn(() => {
      throw new Error("QuotaExceeded");
    });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    expect(() => setBinding("dictation", bind("KeyD", { alt: true }))).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });
});

describe("bindingFromEvent", () => {
  it("waits while only modifiers are down", () => {
    for (const code of ["AltLeft", "ControlRight", "MetaLeft", "ShiftLeft", "OSRight", "Alt"]) {
      expect(bindingFromEvent(press(code, { altKey: true }))).toBeNull();
    }
  });

  it("refuses a bare key or Shift alone, which would steal typing", () => {
    expect(bindingFromEvent(press("KeyA"))).toBeNull();
    expect(bindingFromEvent(press("KeyA", { shiftKey: true }))).toBeNull();
  });

  it("captures the physical key and every modifier", () => {
    expect(bindingFromEvent(press("KeyA", { ctrlKey: true, shiftKey: true }))).toEqual(bind("KeyA", { ctrl: true, shift: true }));
    expect(bindingFromEvent(press("Quote", { altKey: true }))).toEqual(bind("Quote", { alt: true }));
    expect(bindingFromEvent(press("Digit1", { metaKey: true }))).toEqual(bind("Digit1", { meta: true }));
  });
});

describe("matches", () => {
  const b = bind("KeyD", { alt: true, shift: true });

  it("matches the same key and exactly the same modifiers", () => {
    expect(matches({ code: "KeyD", altKey: true, ctrlKey: false, metaKey: false, shiftKey: true }, b)).toBe(true);
  });

  it("fails on a different key, a missing modifier, or a different shift", () => {
    const base = { code: "KeyD", altKey: true, ctrlKey: false, metaKey: false, shiftKey: true };
    expect(matches({ ...base, code: "KeyE" }, b)).toBe(false);
    expect(matches({ ...base, altKey: false }, b)).toBe(false);
    expect(matches({ ...base, shiftKey: false }, b)).toBe(false);
  });

  it("also matches when the press holds a modifier the binding leaves out", () => {
    // Command+Option+' is what people reach for when the bare combination is taken, so the
    // Option+' binding has to fire on it too.
    const optionQuote = bind("Quote", { alt: true });
    expect(matches({ code: "Quote", altKey: true, ctrlKey: false, metaKey: true, shiftKey: false }, optionQuote)).toBe(true);
    expect(matches({ code: "Quote", altKey: true, ctrlKey: true, metaKey: false, shiftKey: false }, optionQuote)).toBe(true);
    // A modifier the binding names still has to be held.
    expect(matches({ code: "Quote", altKey: false, ctrlKey: false, metaKey: true, shiftKey: false }, optionQuote)).toBe(false);
  });

  it("does not let a bare key match a binding that names a modifier", () => {
    const commandD = bind("KeyD", { meta: true });
    expect(matches({ code: "KeyD", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }, commandD)).toBe(false);
  });
});

describe("bindingSpec", () => {
  it("writes modifiers in hotkeys order with a lower-case key", () => {
    expect(bindingSpec(bind("KeyK", { ctrl: true, alt: true, shift: true }), true)).toBe("ctrl+alt+shift+k");
    expect(bindingSpec(bind("Digit7", { alt: true }), false)).toBe("alt+7");
  });

  it("uses the symbol for punctuation and a space for Space", () => {
    expect(bindingSpec(bind("Quote", { alt: true }), true)).toBe("alt+'");
    expect(bindingSpec(bind("Space", { ctrl: true }), true)).toBe("ctrl+ ");
  });

  it("maps Command to mod on macOS and drops it elsewhere", () => {
    expect(bindingSpec(bind("KeyD", { meta: true }), true)).toBe("mod+d");
    expect(bindingSpec(bind("KeyD", { meta: true, alt: true }), false)).toBe("alt+d");
  });

  it("lower-cases other key codes as written", () => {
    expect(bindingSpec(bind("F5", { alt: true }), true)).toBe("alt+f5");
  });
});

describe("formatBinding", () => {
  it("uses Apple's symbols in ⌃⌥⇧⌘ order on macOS", () => {
    onMac(true);
    expect(formatBinding(bind("KeyD", { ctrl: true, alt: true, shift: true, meta: true }))).toBe("⌃⌥⇧⌘D");
    expect(formatBinding(bind("Quote", { alt: true }))).toBe("⌥'");
  });

  it("spells modifiers out elsewhere, with Win for the meta key", () => {
    onMac(false);
    expect(formatBinding(bind("Digit3", { ctrl: true, alt: true, shift: true, meta: true }))).toBe("Ctrl+Alt+Shift+Win+3");
    expect(formatBinding(bind("Space", { ctrl: true }))).toBe("Ctrl+Space");
  });

  it("treats a missing navigator as not macOS", () => {
    vi.stubGlobal("navigator", undefined);
    expect(formatBinding(bind("KeyA", { alt: true }))).toBe("Alt+A");
  });
});

describe("bindingAccelerator", () => {
  it("writes the default Option+' as Alt+'", () => {
    expect(bindingAccelerator(currentBinding("dictation"))).toBe("Alt+'");
  });

  it("orders modifiers Control, Alt, Shift, Command and drops Key/Digit", () => {
    expect(bindingAccelerator(bind("KeyD", { meta: true, shift: true }))).toBe("Shift+Command+D");
    expect(bindingAccelerator(bind("KeyK", { ctrl: true, alt: true, shift: true, meta: true }))).toBe("Control+Alt+Shift+Command+K");
    expect(bindingAccelerator(bind("Digit5", { alt: true }))).toBe("Alt+5");
  });

  it("uses Electron's names for named keys and the symbol for punctuation", () => {
    expect(bindingAccelerator(bind("Space", { ctrl: true }))).toBe("Control+Space");
    expect(bindingAccelerator(bind("ArrowUp", { alt: true }))).toBe("Alt+Up");
    expect(bindingAccelerator(bind("Enter", { meta: true }))).toBe("Command+Return");
    expect(bindingAccelerator(bind("Slash", { alt: true }))).toBe("Alt+/");
    expect(bindingAccelerator(bind("F5", { alt: true }))).toBe("Alt+F5");
  });
});

describe("syncDictationShortcut", () => {
  function installDictation() {
    const setShortcut = vi.fn();
    window.weft = { dictation: { setShortcut } } as unknown as ShellBridge;
    return setShortcut;
  }

  afterEach(() => {
    delete window.weft;
  });

  it("sends the current binding's accelerator to the desktop app", () => {
    const setShortcut = installDictation();
    syncDictationShortcut();
    expect(setShortcut).toHaveBeenCalledExactlyOnceWith("Alt+'");
  });

  it("does nothing in a browser tab or a bridge without dictation", () => {
    expect(() => syncDictationShortcut()).not.toThrow();
    window.weft = {} as unknown as ShellBridge;
    expect(() => syncDictationShortcut()).not.toThrow();
  });

  it("does nothing without a window (server render)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => syncDictationShortcut()).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("sends the new key when dictation is rebound, and the default when it's reset", () => {
    const setShortcut = installDictation();
    setBinding("dictation", bind("KeyD", { meta: true, shift: true }));
    expect(setShortcut).toHaveBeenLastCalledWith("Shift+Command+D");
    setBinding("dictation", null);
    expect(setShortcut).toHaveBeenLastCalledWith("Alt+'");
    expect(setShortcut).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when another shortcut is rebound", () => {
    const setShortcut = installDictation();
    setBinding("other", bind("KeyX", { alt: true }));
    expect(setShortcut).not.toHaveBeenCalled();
  });
});
