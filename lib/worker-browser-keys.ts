// The board's live keys (HID usages, lib/hid-keys.ts) as CDP key events for the worker's browser: the reverse of
// hidUsage, with Shift held across presses the way a keyboard holds it. A key that types something goes in with its
// text, so a field fills as it does under a real keyboard.

type KeyEvent = { type: "keyDown" | "rawKeyDown" | "keyUp"; key: string; code: string; windowsVirtualKeyCode: number; text?: string; modifiers: number };

// usage → [code, key, shifted key, virtual key code]
const NAMED: Record<number, [string, string, string, number]> = {
  40: ["Enter", "Enter", "Enter", 13],
  41: ["Escape", "Escape", "Escape", 27],
  42: ["Backspace", "Backspace", "Backspace", 8],
  43: ["Tab", "Tab", "Tab", 9],
  44: ["Space", " ", " ", 32],
  45: ["Minus", "-", "_", 189],
  46: ["Equal", "=", "+", 187],
  47: ["BracketLeft", "[", "{", 219],
  48: ["BracketRight", "]", "}", 221],
  49: ["Backslash", "\\", "|", 220],
  51: ["Semicolon", ";", ":", 186],
  52: ["Quote", "'", '"', 222],
  53: ["Backquote", "`", "~", 192],
  54: ["Comma", ",", "<", 188],
  55: ["Period", ".", ">", 190],
  56: ["Slash", "/", "?", 191],
  79: ["ArrowRight", "ArrowRight", "ArrowRight", 39],
  80: ["ArrowLeft", "ArrowLeft", "ArrowLeft", 37],
  81: ["ArrowDown", "ArrowDown", "ArrowDown", 40],
  82: ["ArrowUp", "ArrowUp", "ArrowUp", 38],
};
const SHIFTED_DIGITS = ")!@#$%^&*(";
const SHIFT = new Set([225, 229]);
const ALT = new Set([226, 230]);
const TYPES = new Set(["Enter", " "]);

const held = { shift: false, alt: false };

function keyOf(code: number): [string, string, string, number] | null {
  if (code >= 4 && code <= 29) {
    const letter = String.fromCharCode(code + 61);
    return [`Key${letter}`, letter.toLowerCase(), letter, letter.charCodeAt(0)];
  }
  if (code >= 30 && code <= 39) {
    const digit = code === 39 ? 0 : code - 29;
    return [`Digit${digit}`, String(digit), SHIFTED_DIGITS.charAt(digit), 48 + digit];
  }
  return NAMED[code] ?? null;
}

// null for a modifier (it's remembered instead) or a usage this doesn't know.
export function keyFor(usage: number, down: boolean): KeyEvent | null {
  if (SHIFT.has(usage)) return void (held.shift = down), null;
  if (ALT.has(usage)) return void (held.alt = down), null;
  const known = keyOf(usage);
  if (!known) return null;
  const [code, plain, shifted, vk] = known;
  const key = held.shift ? shifted : plain;
  const modifiers = (held.alt ? 1 : 0) | (held.shift ? 8 : 0);
  const base = { key, code, windowsVirtualKeyCode: vk, modifiers };
  if (!down) return { type: "keyUp", ...base };
  const types = key.length === 1 || TYPES.has(key);
  return types ? { type: "keyDown", ...base, text: key === "Enter" ? "\r" : key } : { type: "rawKeyDown", ...base };
}

// Between tests, and when a line closes mid-press.
export function releaseKeys() {
  held.shift = false;
  held.alt = false;
}
