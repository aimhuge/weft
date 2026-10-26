// "Repeat from here" on a message (components/RepeatFromHere.tsx) opens the thread header's ⏰ on that message
// (components/CronButton.tsx) through a window event, without threading a callback through the memoised thread view.

// A message the ⏰ popover forks at: one whose "Repeat from here" was clicked, or the thread's last one.
export interface CronAnchor {
  // The id the message went to the CLI with (lib/edit-last.ts); missing when the session can't be forked there.
  id?: string;
  text: string;
}

export const CRON_FROM_EVENT = "weft:cron-from";

export function repeatFrom(cardId: string, anchor: CronAnchor) {
  window.dispatchEvent(new CustomEvent(CRON_FROM_EVENT, { detail: { cardId, anchor } }));
}

// Calls `on` with the anchor when a message of this card asks for it; returns the unsubscribe.
export function onRepeatFrom(cardId: string, on: (anchor: CronAnchor) => void): () => void {
  const listener = (e: Event) => {
    // Another script's event of the same name may carry nothing.
    const detail = (e as CustomEvent<{ cardId: string; anchor: CronAnchor } | null>).detail;
    if (detail?.cardId === cardId) on(detail.anchor);
  };
  window.addEventListener(CRON_FROM_EVENT, listener);
  return () => window.removeEventListener(CRON_FROM_EVENT, listener);
}
