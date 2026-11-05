// Away open: while you're away from the board (no input in its window for a few minutes) and no card is
// open, a card that moves into Needs you opens by itself, so the question is waiting when you look back.
// Cards that arrive after it join a stack: the open card's header shows "1 of 3 waiting" with Next, and
// answering the open one moves on to the next. Off unless Settings → General turns it on.
//
// The preference lives in a cookie, like the chimes (lib/chimes.ts): the desktop server's port can
// change, and each port is its own localStorage. The stack is a small store the hook
// (lib/use-away-open.ts) and the header chip (components/AwayStackChip.tsx) both read.

export type AwayPrefs = { on: boolean; minutes: number };

export const AWAY_COOKIE = "weft-away-open";
export const AWAY_DEFAULTS: AwayPrefs = { on: false, minutes: 2 };
export const AWAY_MINUTES = [1, 2, 5, 10, 15] as const;

export function awayPrefs(): AwayPrefs {
  const match = document.cookie.match(new RegExp(`(?:^|; )${AWAY_COOKIE}=([^;]*)`));
  const text = match?.[1];
  if (!text) return AWAY_DEFAULTS;
  try {
    const value = JSON.parse(decodeURIComponent(text)) as Partial<AwayPrefs>;
    return {
      on: value.on === true,
      minutes: typeof value.minutes === "number" && value.minutes > 0 ? value.minutes : AWAY_DEFAULTS.minutes,
    };
  } catch {
    return AWAY_DEFAULTS;
  }
}

export function setAwayPrefs(prefs: AwayPrefs) {
  const value = encodeURIComponent(JSON.stringify(prefs));
  document.cookie = `${AWAY_COOKIE}=${value}; path=/; max-age=${10 * 365 * 24 * 60 * 60}; SameSite=Lax`;
}

// The stack: the open card first, then the cards waiting behind it. Empty when the open card (if any)
// is one you opened yourself.
let stack: readonly string[] = [];
const listeners = new Set<() => void>();
// How the store opens a card (the board's select) and tells a card still waiting in Needs you, both
// registered by the hook. Next and an answered card skip ones that moved on or were deleted.
let opener: ((id: string | null) => void) | null = null;
let stillWaiting: (id: string) => boolean = () => true;

function set(next: readonly string[]) {
  stack = next;
  for (const listener of listeners) listener();
}

export function awayStack(): readonly string[] {
  return stack;
}

export function subscribeAwayStack(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setAwayOpener(open: ((id: string | null) => void) | null, waiting: (id: string) => boolean = () => true) {
  opener = open;
  stillWaiting = waiting;
}

export interface Arrival {
  id: string;
  // The card open now, if any.
  selected: string | null;
  // Something else holds the screen (the New thread form), so nothing opens over it.
  busy: boolean;
  idleMs: number;
  prefs: AwayPrefs;
}

// A card just moved into Needs you. Opens it when you're away and nothing is open; stacks it behind
// a card this opened; otherwise leaves it to the chime. Returns what it did.
export function arrive({ id, selected, busy, idleMs, prefs }: Arrival): "open" | "stack" | null {
  if (!prefs.on || idleMs < prefs.minutes * 60_000) return null;
  if (stack.includes(id)) return null;
  if (!selected && !busy) {
    set([id]);
    opener?.(id);
    return "open";
  }
  if (selected && stack[0] === selected) {
    set([...stack, id]);
    return "stack";
  }
  return null;
}

// Next: drops the open card from the stack and opens the next one still waiting. The last one
// leaves the stack empty and the open card where it is.
export function nextAway(waiting: (id: string) => boolean = stillWaiting) {
  const rest = stack.slice(1).filter(waiting);
  const next = rest[0];
  set(rest);
  if (next) opener?.(next);
  return next ?? null;
}

// A card left Needs you, or was deleted: answering the open one moves on to the next; one further back
// just leaves.
export function leaveAway(id: string, waiting?: (id: string) => boolean) {
  if (!stack.includes(id)) return null;
  if (stack[0] === id) return stack.length > 1 ? nextAway(waiting) : (set([]), null);
  set(stack.filter((s) => s !== id));
  return null;
}

// The open card changed: opening another card yourself, or closing the panel, ends the stack.
export function selectedAway(selected: string | null) {
  if (stack.length && stack[0] !== selected) set([]);
}
