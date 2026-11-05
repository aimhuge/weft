// The live screen's input on an Android emulator (docs/architecture/weft-worker.md#the-fast-path), as lines for one
// `adb shell` the watch keeps open: idb's HID gestures and keys have no adb twin, so each becomes an `input` command.
// Every line is built here from numbers and quoted text, so nothing the board sends runs as shell on the device.
import { charOf, SHIFT_USAGE } from "./hid-text";
import { shellQuote } from "./simulator-exec";

// HID usages of the keys that type nothing, as Android key codes: Enter, Escape, Backspace, Tab, the arrows.
const KEYCODES: Record<number, number> = { 40: 66, 41: 111, 42: 67, 43: 61, 79: 22, 80: 21, 81: 20, 82: 19 };
const RIGHT_SHIFT = 229;
// `input text` gets long lines in pieces, so one paste doesn't make one huge command.
const PIECE = 200;
// A press that moved less than this (a fraction of the screen) and was quick is a tap; anything else is a swipe.
const STILL = 0.01;
const TAP_MS = 300;
const SWIPE_MS = { min: 50, max: 5_000 };

// `input text`'s own escapes: %s is a space, so a % is escaped first; then the device's shell gets one quoted word.
const textLine = (text: string) => `input text ${shellQuote(text.replace(/%/g, "\\%").replace(/ /g, "%s"))}`;

/** The lines that type `text`: printable ASCII as `input text`, a newline as Enter, a tab as Tab; anything else dropped. */
export function textLines(text: string): string[] {
  const lines: string[] = [];
  for (const part of text.replace(/\r\n?/g, "\n").split(/([\n\t])/)) {
    if (part === "\n") lines.push("input keyevent 66");
    else if (part === "\t") lines.push("input keyevent 61");
    else {
      const plain = part.replace(/[^\x20-\x7e]/g, "");
      for (let at = 0; at < plain.length; at += PIECE) lines.push(textLine(plain.slice(at, at + PIECE)));
    }
  }
  return lines;
}

/** The board's keys, by HID usage: Shift held across presses, a key that types something typed, the rest by key code. */
export function keyLines() {
  let shift = false;
  return (usage: number, down: boolean): string[] => {
    if (usage === SHIFT_USAGE || usage === RIGHT_SHIFT) {
      shift = down;
      return [];
    }
    if (!down) return [];
    const code = KEYCODES[usage];
    if (code !== undefined) return [`input keyevent ${code}`];
    const char = charOf(usage, shift);
    return char ? textLines(char) : [];
  };
}

type Point = { x: number; y: number };

/** A live gesture as one command when it ends: a tap, or a swipe over the time it took (a long press is a swipe that didn't move). */
export function gestureLines(size: { width: number; height: number }, now: () => number = Date.now) {
  let from: (Point & { at: number }) | null = null;
  const px = (p: Point) => `${Math.round(p.x)} ${Math.round(p.y)}`;
  return (phase: "down" | "move" | "up", x: number, y: number): string[] => {
    if (phase === "down") from = { x, y, at: now() };
    if (phase !== "up" || !from) return [];
    const start = from;
    from = null;
    const ms = now() - start.at;
    const still = Math.abs(x - start.x) < STILL * size.width && Math.abs(y - start.y) < STILL * size.height;
    if (still && ms < TAP_MS) return [`input tap ${px(start)}`];
    return [`input swipe ${px(start)} ${px({ x, y })} ${Math.min(SWIPE_MS.max, Math.max(SWIPE_MS.min, ms))}`];
  };
}

/** The display as input takes it, in pixels: the override size when there is one (`wm size`). */
export function wmSize(out: string): { width: number; height: number } {
  const sizes = [...out.matchAll(/(Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const pick = sizes.find((m) => m[1] === "Override") ?? sizes[0];
  if (!pick) throw new Error("adb didn't report the screen's size.");
  return { width: Number(pick[2]), height: Number(pick[3]) };
}
