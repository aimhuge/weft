// What the reply box is doing right now, and so what Enter does: one mode at a time, named on a chip in the
// box (left out for a plain reply) and on the primary button, with everything else in the button's ▾ menu.
// Pure, so a test can pin every state (components/ReplyBox.tsx draws it; docs/architecture/composer.md).
import { cacheMinutesLeft, folderName, formatTokens } from "./format";
import { formatAt } from "./schedule";
import type { CacheState, Card, LimitWindow } from "./types";

export type ReplyModeName = "reply" | "steer" | "queue" | "answer" | "shell" | "replace" | "copy";

// What a click on the primary or a menu item does; ReplyBox maps each to its handler.
export type ReplyAction = "done" | "send" | "steer" | "queue" | "sendNow" | "answer" | "run" | "replace" | "continue" | "fresh" | "schedule" | "later";

export type ReplyTone = "accent" | "neutral" | "shell" | "warn";

export interface ReplyMenuItem {
  action: ReplyAction;
  label: string;
  keys?: string;
}

export interface ReplyModeView {
  mode: ReplyModeName;
  // The chip's words in the box; undefined for a plain reply, which needs no label.
  chip?: string;
  tone: ReplyTone;
  primary: { action: ReplyAction; label: string; tip: string };
  // A second button beside the primary, equally visible (a cold cache on a long thread: Send here / New card).
  // Wrap the thread up (/weft:done here), offered whenever the thread is idle, cold cache or not.
  done?: { action: ReplyAction; label: string; tip: string };
  // Send "continue" (⌘⇧↵), offered whenever the thread is idle, unless the primary already is Continue.
  cont?: { action: ReplyAction; label: string; tip: string; keys: string };
  menu: ReplyMenuItem[];
}

export interface ReplyModeInput {
  live: boolean;
  // A live turn takes a message in after its next tool call (Claude Code and puku; lib/runner-steer.ts).
  midTurn?: boolean;
  question: boolean;
  shell: boolean;
  editing: boolean;
  // Editing only: Enter replaces the last message and its turn (else it goes as a copy), and what that turn changed on disk.
  canRewind?: boolean;
  fileEdits?: number;
  empty: boolean;
  // The card's folder name, for the shell chip.
  folder?: string;
  // The prompt cache has gone cold: the next message here re-sends this many tokens. Only when a new card can take over.
  cold?: { tokens: string };
  // The 5-hour window is used up; it resets at this time (ms). Only where Send later is offered.
  limitResetAt?: number;
  // The last turn stopped short (a stop, an error, a plan limit, the app closing), so "continue" makes sense.
  cutOff: boolean;
  // Board threads take Send later; the copilot doesn't.
  canSchedule: boolean;
  // The CLI can start a new session in this card from a brief (lib/splice.ts sendFresh). False for codex,
  // which only resumes its own session.
  canFresh?: boolean;
  // No prior assistant turn: the model/CLI was just switched, or the card was never started. Distinct from
  // cutOff (a turn stopped short) and from cold (cache is cold but the assistant did answer). When true,
  // Continue has no meaning here — the reply box defaults to Send fresh, or to Send for codex, and the
  // ▾ menu and ⌘⇧↵ Continue keybinding are hidden.
  noPriorContext?: boolean;
  now: number;
}

// Below this many cached tokens a cold cache costs too little to talk about: no chip, no New card button.
export const COLD_MIN_TOKENS = 30_000;

const DONE = { action: "done", label: "Done", tip: "Run /weft:done in this thread: tests, docs, commit and push" } as const;

const CONTINUE = { action: "continue", label: "Continue", tip: "Send “continue” so the thread keeps going", keys: "mod+shift+Enter" } as const;

const LATER: ReplyMenuItem = { action: "later", label: "Send later…", keys: "alt+Enter" };

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

// ↑ pulled the last message back: Enter replaces it (amber: its turn is undone), or sends a copy where the thread can't rewind.
function editMode(input: ReplyModeInput): ReplyModeView {
  if (!input.canRewind) {
    return {
      mode: "copy",
      chip: "Editing a copy · this thread can't rewind · Esc",
      tone: "accent",
      primary: { action: "replace", label: "Send copy", tip: "Send this as a new message (Enter)" },
      menu: [],
    };
  }
  const files = input.fileEdits ? ` · ${plural(input.fileEdits, "file edit")} ${input.fileEdits === 1 ? "stays" : "stay"}` : "";
  const how = input.live ? "Stops this turn and replaces" : "Replaces";
  return {
    mode: "replace",
    chip: `Replace last message${files} · Esc`,
    tone: "warn",
    primary: { action: "replace", label: "Replace", tip: `${how} your last message and its reply (Enter)` },
    menu: [],
  };
}

// No prior assistant context + 5-hour limit used up: the limit takes priority (you can't send now
// anyway) but the fresh-start chip stays on, and Send fresh is in the ▾ menu for the user who
// can't wait (Claude/puku only; codex doesn't get Send fresh).
function noPriorSchedule(input: ReplyModeInput, here: string, later: ReplyMenuItem[]): ReplyModeView {
  const resetAt = input.limitResetAt as number;
  return {
    mode: "reply",
    chip: "Fresh start · 5-hour limit used up",
    tone: "accent",
    primary: { action: "schedule", label: `Send at ${formatAt(resetAt, input.now)}`, tip: "Send when the 5-hour window resets (Enter)" },
    menu: [{ action: "send", label: here }, ...(input.canFresh ? [{ action: "fresh", label: "Send fresh now" } as ReplyMenuItem] : []), ...later],
  };
}

// No prior assistant context, no 5-hour limit: the primary is Send fresh (Claude/puku) or plain
// Send (codex). The full-history send is useful even on codex, so we offer it whenever the cache
// is cold, regardless of canFresh.
function noPriorFresh(input: ReplyModeInput): ReplyModeView {
  const chip = input.cold ? `Fresh start · was on another model · re-sends ${input.cold.tokens}` : "Fresh start · was on another model";
  const primary = input.canFresh
    ? {
        action: "fresh" as const,
        label: "Send fresh",
        tip: input.cold
          ? `A new session in this card, started from a short brief of the thread and its diff, instead of re-sending ${input.cold.tokens} tokens (Enter)`
          : "A new session in this card, started from a short brief of the thread (Enter)",
      }
    : { action: "send" as const, label: "Send", tip: "Send (Enter)" };
  const menu: ReplyMenuItem[] = input.cold ? [{ action: "send", label: `Send with full history · ${input.cold.tokens}` }] : [];
  return { mode: "reply", chip, tone: "accent", primary, menu };
}

// No turn running, nothing asked: the right default for Enter given the cache and the plan window.
function idleMode(input: ReplyModeInput): ReplyModeView {
  const later = input.canSchedule ? [LATER] : [];
  const here = input.cold ? `Send here · re-sends ${input.cold.tokens}` : "Send now anyway";
  if (input.noPriorContext) {
    if (input.limitResetAt && input.canSchedule) return noPriorSchedule(input, here, later);
    return noPriorFresh(input);
  }
  if (input.limitResetAt && input.canSchedule) {
    const fresh: ReplyMenuItem[] = input.cold ? [{ action: "fresh", label: "Send fresh now" }] : [];
    return {
      mode: "reply",
      chip: "5-hour limit used up",
      tone: "accent",
      primary: { action: "schedule", label: `Send at ${formatAt(input.limitResetAt, input.now)}`, tip: "Send when the 5-hour window resets (Enter)" },
      menu: [{ action: "send", label: here }, ...fresh, ...later],
    };
  }
  if (input.cold) {
    return {
      mode: "reply",
      chip: `Cache cold · ${input.cold.tokens}`,
      tone: "accent",
      primary: {
        action: "fresh",
        label: "Send fresh",
        tip: `A new session in this card, started from a short brief of the thread and its diff, instead of re-sending ${input.cold.tokens} tokens (Enter)`,
      },
      menu: [{ action: "send", label: `Send with full history · ${input.cold.tokens}` }, ...later],
    };
  }
  if (input.empty && input.cutOff) {
    return {
      mode: "reply",
      tone: "accent",
      primary: { action: "continue", label: "Continue", tip: "Send “continue” so the thread picks up where it stopped (Enter)" },
      menu: later,
    };
  }
  return { mode: "reply", tone: "accent", primary: { action: "send", label: "Send", tip: "Send (Enter)" }, menu: later };
}

export function replyMode(input: ReplyModeInput): ReplyModeView {
  if (input.editing) return editMode(input);
  if (input.shell) {
    return {
      mode: "shell",
      chip: input.folder ? `Shell · ${input.folder}` : "Shell",
      tone: "shell",
      primary: { action: "run", label: "Run", tip: "Run in this folder's shell; the output goes to the agent with your next message (Enter)" },
      menu: [],
    };
  }
  if (input.question) {
    return { mode: "answer", chip: "Answer", tone: "warn", primary: { action: "answer", label: "Answer", tip: "Answer the question (Enter)" }, menu: [] };
  }
  if (input.live && input.midTurn) {
    return {
      mode: "steer",
      chip: "After the next tool call",
      tone: "neutral",
      primary: { action: "steer", label: "Send", tip: "The agent reads it as its next tool call returns, without stopping the turn (Enter)" },
      menu: [{ action: "queue", label: "Queue · after this turn" }, { action: "sendNow", label: "Send now (stops the turn)" }, ...(input.canSchedule ? [LATER] : [])],
    };
  }
  if (input.live) {
    return {
      mode: "queue",
      chip: "Queue · after this turn",
      tone: "neutral",
      primary: { action: "queue", label: "Queue", tip: "Send when this turn finishes (Enter)" },
      menu: [{ action: "sendNow", label: "Send now (stops the turn)" }, ...(input.canSchedule ? [LATER] : [])],
    };
  }
  const idle = idleMode(input);
  // No prior context: Continue has no meaning here (the menu item is hidden and ⌘⇧↵ is a no-op, in
  // components/ReplyBox.tsx). Otherwise, hide it only when the primary is already Continue.
  const cont = input.noPriorContext || idle.primary.action === "continue" ? undefined : CONTINUE;
  return { ...idle, done: DONE, cont };
}

// When this thread's 5-hour window is used up, the time it resets (ms): the window's own reset when it's still ahead,
// else the plan's next one. Undefined while there's room left, or once the reset has passed.
export function limitResetAt(window: LimitWindow | undefined, planReset: number | undefined, now: number): number | undefined {
  if (!window || window.used < 100) return undefined;
  const own = window.resetsAt ? window.resetsAt * 1000 : undefined;
  if (own !== undefined) return own > now ? own : undefined;
  return planReset !== undefined && planReset > now ? planReset : undefined;
}

// The last turn stopped short, so "continue" makes sense: you stopped it, it failed, it hit the plan limit, or the
// app closed in the middle of it (lib/card-resume.ts CLOSED_LINE starts with "Stopped" too).
export function turnCutOff(card: Pick<Card, "error" | "lastLine" | "rateLimitHit" | "interrupted">): boolean {
  return Boolean(card.error) || Boolean(card.lastLine?.startsWith("Stopped")) || Boolean(card.rateLimitHit) || Boolean(card.interrupted);
}

// The reply box's own props and state, read into replyMode's inputs: the cache counts as cold only while idle, the
// limit only where Send later is offered (and once the clock has started, now > 0).
export interface ReplyBoxState {
  live: boolean;
  midTurn?: boolean;
  question: boolean;
  shell: boolean;
  editing: boolean;
  editLast?: { canRewind: boolean; fileEdits: number };
  empty: boolean;
  cwd: string;
  cache?: CacheState;
  fiveHour?: LimitWindow;
  // The plan's next 5-hour reset, where Send later is offered (undefined where it isn't).
  sendLater?: { planReset?: number };
  // The reset this thread has to wait for, when the caller knows more than this thread's own
  // snapshot does: the shared limit stores (lib/limit-reset.ts) also know the model's own cap and
  // the CLI's weekly window. When it's there, it answers instead of fiveHour + planReset.
  limitResetAt?: number;
  cutOff: boolean;
  // No prior assistant turn in the current session (model/CLI was just switched, or the card was never started).
  // When true, the reply box defaults to Send fresh (or Send for codex) and Continue is hidden.
  noPriorContext?: boolean;
  // The CLI can start a new session from a brief (lib/splice.ts). False for codex.
  canFresh?: boolean;
  now: number;
}

export function replyBoxMode(s: ReplyBoxState): { view: ReplyModeView; resetAt?: number } {
  const resetAt = s.sendLater && s.now
    ? s.limitResetAt ?? limitResetAt(s.fiveHour, s.sendLater.planReset, s.now)
    : undefined;
  const cold = s.cache && !s.live && s.now && s.cache.tokens >= COLD_MIN_TOKENS && cacheMinutesLeft(s.cache, s.now) <= 0 ? s.cache : undefined;
  const view = replyMode({
    live: s.live,
    midTurn: s.midTurn,
    question: s.question,
    shell: s.shell,
    editing: s.editing && Boolean(s.editLast),
    canRewind: s.editLast?.canRewind,
    fileEdits: s.editLast?.fileEdits,
    empty: s.empty,
    folder: folderName(s.cwd),
    cold: cold && { tokens: formatTokens(cold.tokens) },
    limitResetAt: resetAt,
    cutOff: s.cutOff,
    canSchedule: Boolean(s.sendLater),
    canFresh: s.canFresh,
    noPriorContext: s.noPriorContext,
    now: s.now,
  });
  return { view, resetAt };
}
