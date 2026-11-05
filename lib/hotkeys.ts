"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// One registry for the app's keyboard shortcuts. Components register theirs with useShortcuts, a single
// window listener dispatches, and the "?" dialog lists whatever is registered.
//
// A key is written like "n", "?", "ArrowDown" or "mod+k": "mod" is Cmd on macOS and Ctrl elsewhere, and
// "ctrl" (Control on macOS too), "alt" and "shift" work as written. Letters and digits compare
// case-insensitively; for a symbol like "?" Shift is whatever it takes to type it.
//
// Plain keys are ignored while typing in an input, textarea, select, or editor. A shortcut with "mod" or
// "alt" still fires there, and allowInInput lets one opt in outright (Escape will want that).
//
// When several shortcuts share a key, the one registered last runs first (so a dialog can claim Escape
// ahead of the board). A handler that returns false passes the key on to the next one and leaves the
// browser's default alone; any other return counts as handled and prevents the default.

export type ShortcutGroup = "General" | "Board" | "Thread" | "Writing" | "Terminal & browser" | "App";

// The order the help dialog lists groups in.
export const SHORTCUT_GROUPS: ShortcutGroup[] = ["General", "Board", "Thread", "Writing", "Terminal & browser", "App"];

export type ShortcutDef = {
  // Unique and stable; hooks match their handlers to the registered shortcut by it.
  id: string;
  // Alternatives for the same action, e.g. ["j", "ArrowDown"].
  keys: string[];
  description: string;
  group: ShortcutGroup;
  allowInInput?: boolean;
  // Checked on each key press, so it can follow state. A disabled shortcut stays in the help list.
  enabled?: boolean;
  handler: (e: KeyboardEvent) => unknown;
};

// What the help dialog sees.
export type ShortcutInfo = Pick<ShortcutDef, "id" | "keys" | "description" | "group">;

type Combo = { key: string; mod: boolean; ctrl: boolean; alt: boolean; shift: boolean };

type Entry = ShortcutInfo & {
  combos: Combo[];
  allowInInput: boolean;
  isEnabled: () => boolean;
  run: (e: KeyboardEvent) => unknown;
};

function parse(spec: string): Combo {
  const parts = spec.split("+");
  const key = parts.pop() || "+";
  const mods = parts.map((p) => p.toLowerCase());
  return {
    key,
    mod: mods.includes("mod"),
    ctrl: mods.includes("ctrl"),
    alt: mods.includes("alt"),
    shift: mods.includes("shift"),
  };
}

export function isMac() {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
}

function matches(combo: Combo, e: KeyboardEvent, mac: boolean) {
  // Off macOS "mod" and "ctrl" are the same key; the other platform's primary modifier is a different shortcut.
  if (e.ctrlKey !== (mac ? combo.ctrl : combo.mod || combo.ctrl)) return false;
  if (e.metaKey !== (mac && combo.mod)) return false;
  if (e.altKey !== combo.alt) return false;
  if (combo.key.length === 1) {
    if (e.key.toLowerCase() !== combo.key.toLowerCase()) return false;
    // Shift is part of typing a symbol, but it tells "n" from "N".
    return !/[a-z0-9]/i.test(combo.key) || e.shiftKey === combo.shift;
  }
  return e.key === combo.key && e.shiftKey === combo.shift;
}

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "tel", "password", "number", "date", "time", ""]);

export function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUTS.has(target.type);
}

// Where a key may come from and still be meant for the board: anything a click leaves focus on that isn't the board
// (a control, a dialog, a frame) says the key was meant for that, even when it isn't a text field.
const NOT_THE_BOARD = "[role='dialog'], [aria-modal='true'], dialog, button, a, input, select, textarea, iframe, webview, [contenteditable]";

// True when a key was pressed on the board itself: nothing focused (the page's body) with no dialog up, or an element
// inside the board's columns ([data-board-surface], components/BoardColumns.tsx) that isn't a control. A plain letter
// that opens something heavy (the terminal) checks it, so a stray key from a panel or a review box never does.
export function onBoardItself(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target === document.body || target === document.documentElement) return !document.querySelector("[aria-modal='true'], dialog[open]");
  if (isTyping(target) || target.closest(NOT_THE_BOARD)) return false;
  return Boolean(target.closest("[data-board-surface]"));
}

let entries: Entry[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function register(add: Entry[]) {
  entries = [...entries, ...add];
  emit();
  return () => {
    entries = entries.filter((e) => !add.includes(e));
    emit();
  };
}

function dispatch(e: KeyboardEvent) {
  // Something nearer the key already took it, or an IME is composing.
  if (e.defaultPrevented || e.isComposing) return;
  const mac = isMac();
  const typing = isTyping(e.target);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    const combo = entry.combos.find((c) => matches(c, e, mac));
    if (!combo) continue;
    if (typing && !(entry.allowInInput || combo.mod || combo.alt)) continue;
    if (!entry.isEnabled()) continue;
    if (entry.run(e) === false) continue;
    e.preventDefault();
    return;
  }
}

// Attaches the window listener. Mount it once, in the root of the UI.
export function useShortcutListener() {
  useEffect(() => {
    window.addEventListener("keydown", dispatch);
    return () => window.removeEventListener("keydown", dispatch);
  }, []);
}

// Registers shortcuts for as long as the component is mounted. The list must have the same ids on every
// render; keys and descriptions are read once, while handlers and enabled follow the latest render, so
// they can use current state without any memoizing.
export function useShortcuts(defs: ShortcutDef[]) {
  const latest = useRef(defs);
  useEffect(() => {
    latest.current = defs;
  });
  const first = useRef(defs);

  useEffect(() => {
    const current = (id: string) => latest.current.find((d) => d.id === id);
    return register(
      first.current.map((def) => ({
        id: def.id,
        keys: def.keys,
        description: def.description,
        group: def.group,
        combos: def.keys.map(parse),
        allowInInput: Boolean(def.allowInInput),
        isEnabled: () => current(def.id)?.enabled !== false,
        run: (e) => current(def.id)?.handler(e),
      })),
    );
  }, []);
}

const NONE: ShortcutInfo[] = [];
let snapshot: ShortcutInfo[] = NONE;
let snapshotOf: Entry[] | null = null;

function getSnapshot() {
  if (snapshotOf !== entries) {
    snapshotOf = entries;
    snapshot = entries.map(({ id, keys, description, group }) => ({ id, keys, description, group }));
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Every registered shortcut, for the help dialog.
export function useShortcutList() {
  return useSyncExternalStore(subscribe, getSnapshot, () => NONE);
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "⌫",
  " ": "Space",
};

// The key caps to draw for one key spec, e.g. "mod+k" -> ["⌘", "K"]. Modifiers go in Apple's order (⌃⌥⇧⌘).
export function keyCaps(spec: string, mac = isMac()): string[] {
  const combo = parse(spec);
  const caps: string[] = [];
  if (mac) {
    if (combo.ctrl) caps.push("⌃");
    if (combo.alt) caps.push("⌥");
    if (combo.shift) caps.push("⇧");
    if (combo.mod) caps.push("⌘");
  } else {
    if (combo.mod || combo.ctrl) caps.push("Ctrl");
    if (combo.alt) caps.push("Alt");
    if (combo.shift) caps.push("Shift");
  }
  caps.push(KEY_LABELS[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key));
  return caps;
}

// One key spec as text for a tooltip: "⌘K" on macOS, "Ctrl+K" elsewhere.
export function keyLabel(spec: string, mac = isMac()): string {
  return keyCaps(spec, mac).join(mac ? "" : "+");
}

// A tooltip that names a registered shortcut's key, e.g. hint("copilot", "Copilot") -> "Copilot (C)".
// Reads the live registry, so a key changed where it's registered shows up here too.
export function useShortcutHint() {
  const list = useShortcutList();
  return (id: string, label: string) => {
    const spec = list.find((s) => s.id === id)?.keys[0];
    return spec ? `${label} (${keyLabel(spec)})` : label;
  };
}

const ACCELERATOR_KEYS: Record<string, string> = {
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Escape: "Esc",
  " ": "Space",
  "+": "Plus",
};

// A key spec as an Electron accelerator, for native menus: "shift+a" -> "Shift+A", "mod+k" -> "CmdOrCtrl+K".
export function toAccelerator(spec: string): string {
  const combo = parse(spec);
  const key = ACCELERATOR_KEYS[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key);
  return [combo.mod && "CmdOrCtrl", combo.ctrl && "Ctrl", combo.alt && "Alt", combo.shift && "Shift", key]
    .filter(Boolean)
    .join("+");
}
