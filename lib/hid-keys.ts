// A browser key to the HID usage idb presses on the simulator (USB HID Usage Tables, keyboard page). By physical key, so
// Shift, held keys and auto-repeat all behave as they do on a real keyboard.
const NAMED: Record<string, number> = {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  ShiftLeft: 225,
  AltLeft: 226,
  ShiftRight: 229,
  AltRight: 230,
};

export function hidUsage(code: string): number | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return letter.charCodeAt(0) - 61;
  const digit = /^Digit(\d)$/.exec(code)?.[1];
  if (digit) return digit === "0" ? 39 : Number(digit) + 29;
  return NAMED[code] ?? null;
}
