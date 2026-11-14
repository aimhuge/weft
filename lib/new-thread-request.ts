// Opening the New thread dialog from anywhere on the board (the pane's Edit app button, components/AppEditButton.tsx):
// one window event, like lib/open-card.ts, so the asker needs no handle on the board. The board listens in
// lib/use-board-actions.ts, puts the draft in the dialog's remembered draft and opens it on the folder.

export const NEW_THREAD_EVENT = "weft:new-thread";

export interface NewThreadRequest {
  folder?: string;
  draft?: string;
}

export function requestNewThread(request: NewThreadRequest): void {
  window.dispatchEvent(new CustomEvent<NewThreadRequest>(NEW_THREAD_EVENT, { detail: request }));
}

// Calls `handle` with each request; returns the unsubscribe.
export function onNewThreadRequest(handle: (request: NewThreadRequest) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<NewThreadRequest | undefined>).detail;
    if (detail) handle(detail);
  };
  window.addEventListener(NEW_THREAD_EVENT, listener);
  return () => window.removeEventListener(NEW_THREAD_EVENT, listener);
}
