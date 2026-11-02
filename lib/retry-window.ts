import type { Session } from "./runner-state";

// The moment the live CLI spends out of auto mode so a call you allowed once (lib/classifier-denial.ts) gets past
// the classifier. In auto mode a PreToolUse allow doesn't count for every tool (the CLI sends an MCP tool's hook allow
// on to the classifier, "auto mode requires classifier adjudication"), so the granted call's own hook steps the CLI
// into default mode, where its allow does, and the window closes again as soon as that call has run, or after
// WINDOW_MS, or when the turn ends. Every other call's hook waits for it to close, so no other call, a background
// subagent's included, is decided in default mode, where a path outside the cwd would ask you.

export const WINDOW_MS = 3000;

export interface RetryWindow {
  // The granted calls this window was opened for.
  ids: Set<string>;
  // Settles once the CLI is in default mode.
  ready: Promise<void>;
  // Settles once it's back in the card's mode.
  closed: Promise<void>;
  done: (value: undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Out of auto mode for this granted call. A no-op unless the card runs in auto mode on a live CLI.
export function stepOut(session: Session, toolUseId: string): Promise<void> {
  if (session.spec.permissionMode !== "auto" || !session.query) return Promise.resolve();
  let w = session.retryWindow;
  if (!w) {
    const { promise: closed, resolve: done } = Promise.withResolvers<undefined>();
    const ready = session.query.setPermissionMode("default").catch(() => {});
    w = { ids: new Set(), ready, closed, done, timer: setTimeout(() => void backToAuto(session), WINDOW_MS) };
    session.retryWindow = w;
  }
  w.ids.add(toolUseId);
  return w.ready;
}

// A granted call has run: once the last one has, the window closes.
export function retried(session: Session, toolUseId: string) {
  const w = session.retryWindow;
  if (!w?.ids.delete(toolUseId) || w.ids.size) return;
  void backToAuto(session);
}

// Back to the card's mode (auto, or whatever you switched it to meanwhile); the calls waiting on the window go on.
export async function backToAuto(session: Session): Promise<void> {
  const w = session.retryWindow;
  if (!w) return;
  session.retryWindow = undefined;
  clearTimeout(w.timer);
  await w.ready;
  await session.query?.setPermissionMode(session.spec.permissionMode).catch(() => {});
  w.done(undefined);
}

// What another call waits for before its permission is decided: nothing, or the window closing.
export function untilBackInAuto(session: Session): Promise<void> {
  return session.retryWindow?.closed ?? Promise.resolve();
}
