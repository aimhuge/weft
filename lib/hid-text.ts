// Text as US-keyboard key presses, and back (docs/architecture/weft-worker.md#the-fast-path): a paste on the live screen
// is typed on the device as a keyboard would type it, since idb takes only HID key presses (as `idb ui text` does it)
// and an emulator's `input text` takes plain ASCII. Characters a US keyboard can't type are dropped.

// usage → [plain, shifted], the keyboard page of the USB HID Usage Tables.
const KEYS: Record<number, [string, string]> = {
  40: ["\n", "\n"],
  43: ["\t", "\t"],
  44: [" ", " "],
  45: ["-", "_"],
  46: ["=", "+"],
  47: ["[", "{"],
  48: ["]", "}"],
  49: ["\\", "|"],
  51: [";", ":"],
  52: ["'", '"'],
  53: ["`", "~"],
  54: [",", "<"],
  55: [".", ">"],
  56: ["/", "?"],
};
const SHIFTED_DIGITS = ")!@#$%^&*(";
export const SHIFT_USAGE = 225;

/** The character a key types, with or without Shift held, or null for a key that types none. */
export function charOf(usage: number, shift: boolean): string | null {
  if (usage >= 4 && usage <= 29) {
    const letter = String.fromCharCode(usage + 93);
    return shift ? letter.toUpperCase() : letter;
  }
  if (usage >= 30 && usage <= 39) {
    const digit = usage === 39 ? 0 : usage - 29;
    return shift ? SHIFTED_DIGITS.charAt(digit) : String(digit);
  }
  const pair = KEYS[usage];
  return pair ? pair[shift ? 1 : 0] : null;
}

export type HidPress = { usage: number; shift: boolean };

const PRESSES: ReadonlyMap<string, HidPress> = (() => {
  const map = new Map<string, HidPress>();
  for (let usage = 4; usage <= 56; usage++) {
    for (const shift of [false, true]) {
      const char = charOf(usage, shift);
      if (char !== null && !map.has(char)) map.set(char, { usage, shift });
    }
  }
  return map;
})();

/** The presses that type `text`, a \r\n as one Return; a character no US key types is left out. */
export function hidPresses(text: string): HidPress[] {
  // By UTF-16 unit: everything a US key types is ASCII, so half of a surrogate pair is dropped with the rest.
  const plain = text.replace(/\r\n?/g, "\n");
  const presses: HidPress[] = [];
  for (let i = 0; i < plain.length; i++) {
    const press = PRESSES.get(plain.charAt(i));
    if (press) presses.push(press);
  }
  return presses;
}
