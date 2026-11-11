// ⌘T (electron/menus.cjs) opens a blank tab in main, then the pane's address bar takes the focus for its address.
// The pane may mount only after the ask arrives (it was closed, and BrowserPane loads lazily), so the ask
// waits a moment for it, and is taken once.
const EVENT = "pane:new-tab";
const WAIT_MS = 3000;
let askedAt = 0;

export function requestAddressFocus(now = Date.now()) {
  askedAt = now;
  window.dispatchEvent(new Event(EVENT));
}

// Runs fn now when an ask is still waiting, and on each ask after.
export function onAddressFocus(fn: () => void, now: () => number = Date.now) {
  const take = () => {
    if (!askedAt || now() - askedAt > WAIT_MS) return;
    askedAt = 0;
    fn();
  };
  take();
  window.addEventListener(EVENT, take);
  return () => window.removeEventListener(EVENT, take);
}
