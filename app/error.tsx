"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { WebError } from "@/components/web-states/WebError";
import { isLocalBoard } from "@/lib/local-board";

// The board itself failed to draw (a card or panel failing is caught closer, by CrashGuard).
// Usually a thread left Board.tsx or one of its imports half-written; Fast Refresh retries this
// boundary when the file is fixed, and Reload covers the rest.
//
// The same boundary sits behind every weft.zip page (a profile, a shared card, a workspace), where a
// visitor has no ~/.weft and no threads: there it draws the web page's own error (WebError).
export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  const onBoard = useSyncExternalStore(noChange, isLocalBoard, () => false);
  return onBoard ? <BoardError {...props} /> : <WebError {...props} />;
}

const noChange = () => () => {};

function BoardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const restorePane = usePaneOutOfTheWay();
  return (
    <div role="alert" className="flex h-full items-center justify-center bg-canvas p-6">
      <div className="flex max-w-[520px] flex-col gap-3 rounded-xl border border-danger bg-panel p-5">
        <h1 className="text-[15px] font-medium text-danger">The board failed to draw</h1>
        <p className="text-[12.5px] leading-snug text-muted">
          A thread may be partway through editing Weft. Your cards and threads are safe in ~/.weft; try again once the edit
          lands.
        </p>
        <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-sunken p-2.5 font-mono text-[11px] text-ink">
          {error.message || String(error)}
        </pre>
        <div className="flex gap-2">
          <button onClick={retry} className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-on-accent">
            Try again
          </button>
          <button
            onClick={() => {
              restorePane();
              window.location.reload();
            }} className="rounded-lg px-3 py-1.5 text-[12.5px] text-muted hover:bg-sunken hover:text-ink">
            Reload window
          </button>
        </div>
      </div>
    </div>
  );
}

// The browser pane is a native view drawn over the window, so it would cover this message. Hide it while the
// message shows and bring it back after (Try again unmounts this; Reload restores it first).
function usePaneOutOfTheWay() {
  const wasVisible = useRef(false);
  useEffect(() => {
    const browser = window.weft?.browser;
    if (!browser) return;
    let live = true;
    void browser.getState().then((state) => {
      if (!live || !state.visible) return;
      wasVisible.current = true;
      browser.setVisible(false);
    });
    return () => {
      live = false;
      if (wasVisible.current) browser.setVisible(true);
    };
  }, []);
  return () => {
    if (wasVisible.current) window.weft?.browser.setVisible(true);
  };
}
