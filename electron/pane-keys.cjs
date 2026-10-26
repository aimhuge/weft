// mcp__browser__press_key: a combo like "Enter", "Shift+Tab", "Meta+a" or "ArrowDown" as the CDP
// Input.dispatchKeyEvent pair (down, up) Chrome needs to treat it as a real key press: trusted, so forms submit
// on Enter, Tab moves focus and a page's key handlers run.

// key → [windowsVirtualKeyCode, text it types]. Keys without text are sent as rawKeyDown, as Chrome does.
const NAMED = {
  Enter: [13, "\r"],
  Tab: [9],
  Escape: [27],
  Backspace: [8],
  Delete: [46],
  Space: [32, " "],
  ArrowUp: [38],
  ArrowDown: [40],
  ArrowLeft: [37],
  ArrowRight: [39],
  Home: [36],
  End: [35],
  PageUp: [33],
  PageDown: [34],
  Insert: [45],
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, [112 + i]])),
};
const ALIASES = { Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Esc: "Escape", Return: "Enter", Del: "Delete" };
// CDP's modifier bits.
const MODIFIERS = { Alt: 1, Option: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Command: 4, Shift: 8 };
// Chrome on macOS doesn't run editing shortcuts from synthetic key events; CDP takes them as commands instead.
const MAC_COMMANDS = { a: "selectAll", c: "copy", x: "cut", v: "paste", z: "undo" };

function codeFor(key) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return key === " " ? "Space" : key;
}

// "Shift+Tab" → the modifier bits and the key, its alias resolved. Throws on a part that isn't a modifier.
function splitCombo(raw) {
  // "+" on its own, or as the last part ("Shift++"), is the plus key.
  const parts = raw === "+" ? ["+"] : raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw.split("+");
  let modifiers = 0;
  for (const m of parts.slice(0, -1)) {
    const bit = MODIFIERS[m.trim()];
    if (!bit) throw new Error(`${m} isn't a modifier; use Shift, Control, Alt or Meta.`);
    modifiers |= bit;
  }
  const key = parts[parts.length - 1].trim() || " ";
  return { modifiers, key: ALIASES[key] ?? key };
}

// The key as the page sees it: Shift makes a letter a capital.
function shiftedKey(key, modifiers) {
  return (modifiers & MODIFIERS.Shift) !== 0 && /^[a-z]$/.test(key) ? key.toUpperCase() : key;
}

function virtualKeyCode(key) {
  return /^[a-z\d]$/i.test(key) ? key.toUpperCase().charCodeAt(0) : 0;
}

// Returns the two events, or throws with what a combo should look like.
function keyEvents(combo) {
  const raw = String(combo ?? "").trim();
  if (!raw) throw new Error('Give a key, like "Enter", "Shift+Tab" or "Meta+a".');
  const { modifiers, key: typed } = splitCombo(raw);
  const named = NAMED[typed];
  if (named) return pressOf(typed, modifiers, named[0], named[1]);
  if ([...typed].length !== 1) throw new Error(`${typed} isn't a key I know; use a single character or one of ${Object.keys(NAMED).slice(0, 15).join(", ")}.`);
  const key = shiftedKey(typed, modifiers);
  return pressOf(key, modifiers, virtualKeyCode(key), key);
}

// The down/up pair for a key. A chord (Meta+a) types nothing; Enter and Space still do with Shift.
function pressOf(key, modifiers, keyCode, typed) {
  const chord = (modifiers & (MODIFIERS.Control | MODIFIERS.Meta | MODIFIERS.Alt)) !== 0;
  const text = chord ? undefined : typed;
  const base = { key: key === "Space" ? " " : key, code: codeFor(key), windowsVirtualKeyCode: keyCode, modifiers };
  const command = modifiers === MODIFIERS.Meta ? MAC_COMMANDS[key.toLowerCase()] : undefined;
  const down = { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text, unmodifiedText: text } : {}), ...(command ? { commands: [command] } : {}) };
  return [down, { type: "keyUp", ...base }];
}

module.exports = { keyEvents, NAMED };
