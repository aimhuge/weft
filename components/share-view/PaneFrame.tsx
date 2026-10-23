// The shared viewers' iframe, wrapped: a bare <iframe> on a blob that 404s or a site that refuses
// framing is a blank rectangle forever — nothing tells the user anything. PaneFrame puts a
// loading overlay over the frame area until the iframe's onLoad fires, and after LOAD_TIMEOUT_MS
// (or on onError) a message with Try again (a key bump, so the frame really re-mounts) and, when
// the caller has an address to offer, an "Open ↗" link out of the sandbox.
//
// The overlay is a sibling over the iframe inside a position:relative flex:1 wrapper that carries
// the iframe's own sizing class, so the frame keeps exactly the room it had.
"use client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import "./share-view.css";

// Long enough for a big page over a slow link, short enough that a dead blob doesn't read as
// "still loading" forever.
const LOAD_TIMEOUT_MS = 12_000;

// Hand the frame to the caller's ref too, whichever kind it is.
function assignRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (typeof ref === "function") ref(el);
  else if (ref) ref.current = el;
}

export function PaneFrame({
  src,
  title,
  sandbox,
  openHref,
  frameRef,
  className = "wz-sharePaneFrame",
}: {
  src: string;
  title: string;
  // The sandbox attribute, passed straight through; callers own the policy.
  sandbox?: string;
  // A URL to offer as "Open ↗" when framing fails: the site itself for a site pane, the blob's
  // src for a shared page (a blob the viewer can't frame is still openable).
  openHref?: string;
  // The iframe's ref, forwarded for callers that postMessage into the page (SharedApp's bridge).
  frameRef?: Ref<HTMLIFrameElement>;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // The key bump in Try again: a new key remounts the iframe and it reloads from `src`.
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Our own handle on the frame, alongside the caller's forwarded ref: an iframe's `error` event
  // does not bubble, so React's root-level delegation never sees it. The listener is native,
  // attached straight to the element.
  const inner = useRef<HTMLIFrameElement | null>(null);

  // One timer per mount/attempt: cleared on load, on unmount and before a retry.
  useEffect(() => {
    timer.current = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [attempt, src]);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const onError = () => {
      if (timer.current) clearTimeout(timer.current);
      setFailed(true);
    };
    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, [attempt, src]);

  // Our handle plus the caller's forwarded ref, set by one callback ref.
  const setFrame = useCallback(
    (el: HTMLIFrameElement | null) => {
      inner.current = el;
      assignRef(frameRef, el);
    },
    [frameRef],
  );

  const onLoad = () => {
    if (timer.current) clearTimeout(timer.current);
    setLoaded(true);
    setFailed(false);
  };
  const retry = () => {
    if (timer.current) clearTimeout(timer.current);
    setLoaded(false);
    setFailed(false);
    setAttempt((n) => n + 1);
  };

  return (
    <div className="wz-sharePaneFrameWrap">
      <iframe
        key={attempt}
        ref={setFrame}
        title={title}
        src={src}
        {...(sandbox ? { sandbox } : {})}
        className={className}
        onLoad={onLoad}
      />
      {(!loaded || failed) && (
        <div className="wz-sharePaneOverlay" role="status" aria-live="polite">
          {failed ? (
            <div className="wz-sharePaneFailed">
              <p className="wz-sharePaneFailedText">This page didn&apos;t load.</p>
              <div className="wz-sharePaneFailedActions">
                <button type="button" className="wz-sharePaneRetry" onClick={retry}>
                  Try again
                </button>
                {openHref && (
                  <a className="wz-sharePaneOpen" href={openHref} target="_blank" rel="noopener noreferrer">
                    Open ↗
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="wz-sharePaneSkeleton" data-testid="pane-skeleton">
              <span className="wz-sharePaneBar" data-w="60" />
              <span className="wz-sharePaneBar" data-w="90" />
              <span className="wz-sharePaneBar" data-w="75" />
              <span className="wz-sharePaneBar" data-w="45" />
              <span className="wz-sharePaneLoadingText">Loading the page…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Re-exported for the callers' own tests; the ms the failure state waits for. */
export const PANE_FRAME_LOAD_TIMEOUT_MS = LOAD_TIMEOUT_MS;