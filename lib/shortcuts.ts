// User-rebindable shortcuts (today just dictation), kept in this browser's localStorage. Fixed keys that
// aren't configurable live in the registry in ./hotkeys.

export type Binding = { code: string; alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };

export const SHORTCUTS = [{ id: "dictation", label: "Start or stop dictation" }];

const DEFAULTS: Record<string, Binding> = {
  dictation: { code: "Quote", alt: true, ctrl: false, meta: false, shift: false },
};

const STORAGE_KEY = "threadboard.shortcuts";

function readAll(): Record<string, Binding | undefined> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Binding | undefined>;
  } catch {
    return {};
  }
}

export function currentBinding(id: string): Binding {
  // Callers pass ids from SHORTCUTS, which all have a default; an unknown id gets undefined.
  return readAll()[id] ?? (DEFAULTS[id] as Binding);
}

// null puts the default back.
export function setBinding(id: string, binding: Binding | null) {
  const all = readAll();
  // An undefined entry is dropped by JSON.stringify, which puts the default back.
  all[id] = binding ?? undefined;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
  if (id === "dictation") syncDictationShortcut();
}

const MODIFIER_CODES = /^(Alt|Control|Meta|Shift|OS)(Left|Right)?$/;

// The binding a key press describes, or null while it can't be one: only modifiers so far, or none of
// Option, Control, and Command (a bare letter would steal typing).
export function bindingFromEvent(e: KeyboardEvent): Binding | null {
  if (MODIFIER_CODES.test(e.code)) return null;
  if (!e.altKey && !e.ctrlKey && !e.metaKey) return null;
  return { code: e.code, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };
}

// Matches on the physical key, since Option changes the character a key types on macOS.
//
// The pressed modifiers may be a superset of the binding's: a binding of Option+' also fires on
// Command+Option+', which is what people reach for when the bare combination collides with the
// system. Every modifier the binding names must be held; the ones it leaves out are free. Shift is
// the exception - it changes which character the key produces, so it has to match exactly.
export function matches(
  e: { code: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  b: Binding,
) {
  if (e.code !== b.code) return false;
  if (e.shiftKey !== b.shift) return false;
  if (b.alt && !e.altKey) return false;
  if (b.ctrl && !e.ctrlKey) return false;
  if (b.meta && !e.metaKey) return false;
  return true;
}

const CODE_LABELS: Record<string, string> = {
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
};

// A binding as a key spec for ./hotkeys (keyCaps, the "?" dialog). Command is "mod" on macOS; elsewhere
// it's the Windows key, which a spec can't name, so it's left out.
export function bindingSpec(b: Binding, mac: boolean) {
  const key = CODE_LABELS[b.code] ?? b.code.replace(/^(Key|Digit)/, "").toLowerCase();
  const mods = [b.ctrl && "ctrl", b.alt && "alt", b.shift && "shift", b.meta && mac && "mod"].filter(Boolean);
  return [...mods, key === "Space" ? " " : key].join("+");
}

export function formatBinding(b: Binding) {
  const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
  const key = CODE_LABELS[b.code] ?? b.code.replace(/^(Key|Digit)/, "");
  const mods = [
    b.ctrl && (mac ? "⌃" : "Ctrl+"),
    b.alt && (mac ? "⌥" : "Alt+"),
    b.shift && (mac ? "⇧" : "Shift+"),
    b.meta && (mac ? "⌘" : "Win+"),
  ].filter(Boolean);
  return mods.join("") + key;
}

// Electron's names for the keys whose accelerator isn't their CODE_LABELS character.
const ACCELERATOR_KEYS: Record<string, string> = {
  Space: "Space",
  Enter: "Return",
  Tab: "Tab",
  Backspace: "Backspace",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

// A binding as an Electron accelerator ("Alt+'", "Command+Shift+D"), for the system-wide dictation key the desktop
// app registers (electron/dictation-helper.cjs).
export function bindingAccelerator(b: Binding) {
  const key = ACCELERATOR_KEYS[b.code] ?? CODE_LABELS[b.code] ?? b.code.replace(/^(Key|Digit)/, "");
  const mods = [b.ctrl && "Control", b.alt && "Alt", b.shift && "Shift", b.meta && "Command"].filter(Boolean);
  return [...mods, key].join("+");
}

// Tells the desktop app which key starts dictation in every app. The binding lives in the board's localStorage, so
// the board sends it at load and on every change; in a browser tab there's nothing to tell.
export function syncDictationShortcut() {
  if (typeof window === "undefined") return;
  window.weft?.dictation?.setShortcut(bindingAccelerator(currentBinding("dictation")));
}
