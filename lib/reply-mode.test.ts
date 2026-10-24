import { describe, expect, it } from "vitest";
import { COLD_MIN_TOKENS, limitResetAt, replyBoxMode, replyMode, turnCutOff, type ReplyModeInput } from "./reply-mode";

const NOW = new Date("2026-10-19T12:00:00").getTime();
const base: ReplyModeInput = { live: false, question: false, shell: false, editing: false, empty: false, cutOff: false, canSchedule: true, now: NOW };
const at = (patch: Partial<ReplyModeInput>) => replyMode({ ...base, ...patch });
const actions = (patch: Partial<ReplyModeInput>) => at(patch).menu.map((m) => m.action);

describe("replyMode", () => {
  it("is a plain Send with Send later in the menu and no chip when idle", () => {
    const view = at({});
    expect(view).toMatchObject({ mode: "reply", tone: "accent", primary: { action: "send", label: "Send" } });
    expect(view.chip).toBeUndefined();
    expect(actions({})).toEqual(["later"]);
  });

  it("leaves Send later out where the thread can't schedule", () => {
    expect(actions({ canSchedule: false })).toEqual([]);
    expect(actions({ live: true, canSchedule: false })).toEqual(["sendNow"]);
  });

  it("queues while a turn runs, with Send now and Send later in the menu", () => {
    const view = at({ live: true });
    expect(view).toMatchObject({ mode: "queue", chip: "Queue · after this turn", tone: "neutral", primary: { action: "queue", label: "Queue" } });
    expect(view.menu.map((m) => m.action)).toEqual(["sendNow", "later"]);
  });

  it("sends mid-turn where the CLI takes it in after its next tool call, with Queue, Send now and Send later in the menu", () => {
    const view = at({ live: true, midTurn: true });
    expect(view).toMatchObject({ mode: "steer", chip: "After the next tool call", tone: "neutral", primary: { action: "steer", label: "Send" } });
    expect(view.menu.map((m) => m.action)).toEqual(["queue", "sendNow", "later"]);
    expect(at({ live: true, midTurn: true, canSchedule: false }).menu.map((m) => m.action)).toEqual(["queue", "sendNow"]);
  });

  it("answers a waiting question, even mid-turn", () => {
    expect(at({ question: true, live: true })).toMatchObject({ mode: "answer", tone: "warn", primary: { action: "answer", label: "Answer" }, menu: [] });
  });

  it("runs a ! command, naming the folder, ahead of a question or a turn", () => {
    expect(at({ shell: true, question: true, live: true, folder: "weft" })).toMatchObject({
      mode: "shell",
      chip: "Shell · weft",
      tone: "shell",
      primary: { action: "run", label: "Run" },
    });
    expect(at({ shell: true }).chip).toBe("Shell");
  });

  it("replaces the last message while editing, counting the file edits that stay", () => {
    const view = at({ editing: true, canRewind: true, fileEdits: 2, shell: true });
    expect(view).toMatchObject({ mode: "replace", tone: "warn", primary: { action: "replace", label: "Replace" }, menu: [] });
    expect(view.chip).toBe("Replace last message · 2 file edits stay · Esc");
    expect(at({ editing: true, canRewind: true, fileEdits: 1 }).chip).toBe("Replace last message · 1 file edit stays · Esc");
    expect(at({ editing: true, canRewind: true }).chip).toBe("Replace last message · Esc");
    expect(at({ editing: true, canRewind: true, live: true }).primary.tip).toMatch(/^Stops this turn/);
    expect(at({ editing: true, canRewind: true }).primary.tip).toMatch(/^Replaces/);
  });

  it("sends a copy when the thread can't rewind", () => {
    expect(at({ editing: true, canRewind: false })).toMatchObject({ mode: "copy", tone: "accent", primary: { action: "replace", label: "Send copy" } });
  });

  it("offers Continue as the primary only from an empty box after a cut-off turn", () => {
    expect(at({ empty: true, cutOff: true }).primary).toMatchObject({ action: "continue", label: "Continue" });
    expect(at({ empty: true, cutOff: false }).primary.action).toBe("send");
    expect(at({ empty: false, cutOff: true }).primary.action).toBe("send");
    expect(at({ empty: false, cutOff: true }).cont).toMatchObject({ action: "continue", label: "Continue" });
    expect(at({ empty: true, cutOff: true }).cont).toBeUndefined();
  });

  it("always offers a Continue button beside Done while idle, none while queuing", () => {
    expect(at({ cutOff: false }).cont).toMatchObject({ action: "continue", keys: "mod+shift+Enter" });
    expect(at({ live: true }).cont).toBeUndefined();
  });

  it("sends fresh on a long thread's cold cache, with the full-history send in the menu", () => {
    const view = at({ cold: { tokens: "184k" }, cutOff: true });
    expect(view).toMatchObject({ chip: "Cache cold · 184k", primary: { action: "fresh", label: "Send fresh" } });
    expect(view.menu.map((m) => m.label)).toEqual(["Send with full history · 184k", "Send later…"]);
  });

  it("schedules for the reset when the 5-hour window is used up", () => {
    const reset = new Date("2026-10-19T22:39:00").getTime();
    const view = at({ limitResetAt: reset });
    expect(view).toMatchObject({ chip: "5-hour limit used up", primary: { action: "schedule", label: "Send at 10:39pm" } });
    expect(view.menu.map((m) => m.label)).toEqual(["Send now anyway", "Send later…"]);
    expect(at({ limitResetAt: reset, cold: { tokens: "9k" } }).menu.map((m) => m.action)).toEqual(["send", "fresh", "later"]);
    expect(at({ limitResetAt: reset, canSchedule: false }).primary.action).toBe("send");
  });
});

describe("Done button", () => {
  it("is offered while idle, cold or not, and not while busy", () => {
    expect(at({}).done).toMatchObject({ action: "done", label: "Done" });
    expect(at({ cold: { tokens: "184k" } }).done?.action).toBe("done");
    expect(at({ live: true }).done).toBeUndefined();
    expect(at({ shell: true }).done).toBeUndefined();
  });
});

describe("limitResetAt", () => {
  const ahead = NOW / 1000 + 3600;
  it("is undefined while the window has room", () => {
    expect(limitResetAt(undefined, NOW + 1, NOW)).toBeUndefined();
    expect(limitResetAt({ used: 99, resetsAt: ahead }, NOW + 1, NOW)).toBeUndefined();
  });
  it("is the window's own reset while it's ahead", () => {
    expect(limitResetAt({ used: 100, resetsAt: ahead }, NOW + 5, NOW)).toBe(ahead * 1000);
    expect(limitResetAt({ used: 100, resetsAt: NOW / 1000 - 1 }, NOW + 5, NOW)).toBeUndefined();
  });
  it("falls back to the plan's next reset", () => {
    expect(limitResetAt({ used: 100 }, NOW + 5, NOW)).toBe(NOW + 5);
    expect(limitResetAt({ used: 100 }, NOW - 5, NOW)).toBeUndefined();
    expect(limitResetAt({ used: 100 }, undefined, NOW)).toBeUndefined();
  });
});

describe("turnCutOff", () => {
  it("is true after a stop, an error, a plan limit or the app closing", () => {
    expect(turnCutOff({})).toBe(false);
    expect(turnCutOff({ lastLine: "Done: shipped it" })).toBe(false);
    expect(turnCutOff({ lastLine: "Stopped" })).toBe(true);
    expect(turnCutOff({ error: "boom" })).toBe(true);
    expect(turnCutOff({ rateLimitHit: true })).toBe(true);
    expect(turnCutOff({ interrupted: true })).toBe(true);
  });
});

describe("replyBoxMode", () => {
  const box = { live: false, question: false, shell: false, editing: false, empty: false, cwd: "/dev/weft", cutOff: false, now: NOW };
  const cold = { at: NOW - 3600_000, ttl: 300, hit: 0, tokens: 184_100 };
  it("reads a cold cache only while idle", () => {
    expect(replyBoxMode({ ...box, cache: cold }).view.chip).toBe("Cache cold · 184.1k");
    expect(replyBoxMode({ ...box, cache: { ...cold, tokens: COLD_MIN_TOKENS - 1 } }).view).toMatchObject({ primary: { action: "send", label: "Send" } });
    expect(replyBoxMode({ ...box, cache: cold, live: true }).view.primary.action).toBe("queue");
    expect(replyBoxMode({ ...box, cache: { ...cold, at: NOW } }).view.primary.action).toBe("send");
    expect(replyBoxMode({ ...box, cache: cold, now: 0 }).view.primary.action).toBe("send");
  });
  it("reads the limit only where Send later is offered", () => {
    const fiveHour = { used: 100 };
    expect(replyBoxMode({ ...box, fiveHour, sendLater: { planReset: NOW + 60_000 } }).resetAt).toBe(NOW + 60_000);
    expect(replyBoxMode({ ...box, fiveHour }).resetAt).toBeUndefined();
    expect(replyBoxMode({ ...box, fiveHour, sendLater: { planReset: NOW + 60_000 }, now: 0 }).resetAt).toBeUndefined();
  });
  it("edits only with a last message to edit, and names the folder for a shell", () => {
    expect(replyBoxMode({ ...box, editing: true }).view.mode).toBe("reply");
    expect(replyBoxMode({ ...box, editing: true, editLast: { canRewind: true, fileEdits: 0 } }).view.mode).toBe("replace");
    expect(replyBoxMode({ ...box, shell: true }).view.chip).toBe("Shell · weft");
  });
});

describe("noPriorContext", () => {
  // A model/CLI was just switched (lib/backend-switch.ts): the cache is cold, the new session has no
  // assistant history. Continue has no meaning here; the primary defaults to Send fresh, Continue is
  // hidden in the menu and on ⌘⇧↵.
  it("cold cache + canFresh: primary is fresh, chip names it, Continue is hidden", () => {
    const view = at({ noPriorContext: true, canFresh: true, cold: { tokens: "184.1k" } });
    expect(view).toMatchObject({
      mode: "reply",
      chip: "Fresh start · was on another model · re-sends 184.1k",
      primary: { action: "fresh", label: "Send fresh" },
      cont: undefined,
    });
    expect(view.menu.map((m) => m.label)).toEqual(["Send with full history · 184.1k"]);
  });

  it("warm cache + canFresh: primary is fresh, menu empty, Continue is hidden", () => {
    const view = at({ noPriorContext: true, canFresh: true });
    expect(view).toMatchObject({
      mode: "reply",
      chip: "Fresh start · was on another model",
      primary: { action: "fresh", label: "Send fresh" },
      menu: [],
      cont: undefined,
    });
  });

  it("5-hour limit used up + noPriorContext: primary is schedule, fresh is in the menu", () => {
    const reset = new Date("2026-10-19T22:39:00").getTime();
    const view = at({ noPriorContext: true, canFresh: true, limitResetAt: reset });
    expect(view).toMatchObject({
      chip: "Fresh start · 5-hour limit used up",
      primary: { action: "schedule", label: "Send at 10:39pm" },
      cont: undefined,
    });
    expect(view.menu.map((m) => m.action)).toEqual(["send", "fresh", "later"]);
  });

  it("codex (canFresh: false): primary is plain Send, chip still flags fresh start, Continue is hidden", () => {
    const view = at({ noPriorContext: true, canFresh: false });
    expect(view).toMatchObject({
      mode: "reply",
      chip: "Fresh start · was on another model",
      primary: { action: "send", label: "Send" },
      menu: [],
      cont: undefined,
    });
  });

  it("codex + cold cache: primary is plain Send, full-history send in the menu, Continue is hidden", () => {
    const view = at({ noPriorContext: true, canFresh: false, cold: { tokens: "184.1k" } });
    expect(view).toMatchObject({
      chip: "Fresh start · was on another model · re-sends 184.1k",
      primary: { action: "send", label: "Send" },
      cont: undefined,
    });
    expect(view.menu.map((m) => m.label)).toEqual(["Send with full history · 184.1k"]);
  });

  it("round-trips through replyBoxMode with a cold cache", () => {
    const view = replyBoxMode({ live: false, question: false, shell: false, editing: false, empty: true, cwd: "/dev/weft", cutOff: true, canFresh: true, noPriorContext: true, cache: { at: NOW - 3600_000, ttl: 300, hit: 0, tokens: 184_100 }, now: NOW }).view;
    expect(view.chip).toBe("Fresh start · was on another model · re-sends 184.1k");
    expect(view.primary).toMatchObject({ action: "fresh", label: "Send fresh" });
    expect(view.cont).toBeUndefined();
  });

  it("regular card with cutOff and empty: Continue is offered (no regression)", () => {
    const view = at({ empty: true, cutOff: true });
    expect(view).toMatchObject({ primary: { action: "continue", label: "Continue" } });
    expect(view.cont).toBeUndefined();
  });
});
