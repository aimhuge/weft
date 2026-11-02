// ⌘F and ⌘G reach an open thread through the board's menu bridge (lib/board-menu-bridge.ts), which doesn't
// hold the thread's state, so they cross as two window events, like the show rail's (lib/show-events.ts).
const OPEN = "thread-find:open";
const STEP = "thread-find:step";

export const requestThreadFind = () => window.dispatchEvent(new Event(OPEN));
export function onThreadFind(fn: () => void) {
  window.addEventListener(OPEN, fn);
  return () => window.removeEventListener(OPEN, fn);
}

export const stepThreadFind = (by: 1 | -1) => window.dispatchEvent(new CustomEvent(STEP, { detail: by }));
export function onThreadFindStep(fn: (by: 1 | -1) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<1 | -1>).detail);
  window.addEventListener(STEP, handler);
  return () => window.removeEventListener(STEP, handler);
}

// The pane's find field has the board's keyboard focus, so main reads it as "the board": the keys are its.
export const paneFindFocused = () => Boolean(document.activeElement?.closest("[data-pane-find]"));
