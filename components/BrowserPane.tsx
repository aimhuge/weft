"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { BrowserState } from "@/lib/client";
import { clearOfCopilot, useCopilotCover } from "@/lib/copilot-float";
import { setPaneBox } from "@/lib/float-place";
import { appFor } from "@/lib/mini-apps";
import { paneAddress } from "@/lib/app-share-types";
import { useAnyOverlay } from "@/lib/overlay";
import { useMiniApps } from "@/lib/use-mini-apps";
import Icon, { Spinner } from "./Icon";
import AppShareButton from "./AppShareButton";
import SaveAppButton from "./SaveAppButton";
import ZoomMenu from "./ZoomMenu";

const HIDDEN = { x: 0, y: 0, width: 0, height: 0 };
// The page itself is a native Electron view laid over the placeholder below;
// this component draws the toolbar and tells the shell where to put the view.
export default function BrowserPane({
  desktop,
  state,
  obscured,
  expanded,
  width,
  onWidth,
  onClose,
  rail,
  actions,
}: {
  desktop: boolean;
  state: BrowserState;
  obscured: boolean;
  expanded: boolean;
  width: number;
  onWidth: (width: number) => void;
  // Beside an open card this closes the card too: the card and its browser are one window.
  onClose: () => void;
  // The show rail (components/ShowRail.tsx), right of the page; the native view keeps clear of it.
  rail?: ReactNode;
  // The open card's share, star and archive (components/PaneCardMarks.tsx), right of the zoom.
  actions?: ReactNode;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);
  const overlay = useAnyOverlay();
  const hide = obscured || overlay || resizing;
  // The copilot floats over everything, but nothing in the page can cover the native view, so the view
  // keeps clear of the launcher and steps aside under the peek or the chat (measured on the placeholder,
  // which stays put).
  const copilot = useCopilotCover();
  // A shell from before zoom reporting sends no zoom.
  const zoom = state.zoom ?? 100;

  useEffect(() => {
    const bridge = window.weft;
    const el = holder.current;
    if (!bridge || !el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      const clear = hide ? null : clearOfCopilot({ x: r.left, y: r.top, width: r.width, height: r.height }, copilot);
      const box = clear ?? HIDDEN;
      bridge.browser.setBounds(box);
      // Hover bubbles keep clear of the native view; they read this rather than asking the shell.
      setPaneBox(box);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      bridge.browser.setBounds(HIDDEN);
      setPaneBox(null);
    };
  }, [hide, expanded, copilot]);

  // The native view swallows pointer events, so it's hidden while dragging the divider.
  // The standalone pane sits left of the board (components/StandaloneBrowserPane.tsx), so its divider is its right edge.
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    setResizing(true);
    const left = e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
    const move = (ev: PointerEvent) => {
      const max = window.innerWidth - 420;
      onWidth(Math.min(max, Math.max(320, ev.clientX - left)));
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const nav = "rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  // The address input shows the app's name while nobody is editing it; focusing it shows the real URL.
  // A saved app's address is a name (use sans), a real page's stays a URL (use mono).
  const apps = useMiniApps();
  const app = appFor(apps, state.url);

  return (
    <section
      className={`relative flex flex-col border-line bg-panel ${expanded ? "min-w-0 flex-1 border-l" : "shrink-0 border-r"}`}
      style={expanded ? undefined : { width }}
    >
      {!expanded && (
        <div
          onPointerDown={startResize}
          className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize hover:bg-accent/30"
          aria-hidden="true"
        />
      )}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <button className={nav} disabled={!state.canGoBack} onClick={() => window.weft?.browser.back()} aria-label="Back">
          <Icon name="back" size={15} />
        </button>
        <button className={nav} disabled={!state.canGoForward} onClick={() => window.weft?.browser.forward()} aria-label="Forward">
          <Icon name="forward" size={15} />
        </button>
        <button className={nav} disabled={!state.url} onClick={() => window.weft?.browser.reload()} aria-label="Reload">
          {state.loading ? <Spinner size={13} /> : <Icon name="reload" size={15} />}
        </button>
        <AddressInput desktop={desktop} url={state.url} app={app} />
        {/* Save as app: the page joins the left rail below Services (components/AppsRail.tsx). */}
        {desktop && <SaveAppButton url={state.url} title={state.title} />}
        {/* Share an app: shown for a saved app on the board's own pane (no card actions). */}
        {desktop && !actions && <AppShareButton app={app} />}
        {/* Only the page's zoom; ⌘+/−/0, ⌘+scroll and pinch work too. Accent when not 100%. */}
        <ZoomMenu zoom={zoom} disabled={!state.url} />
        {actions}
        <button className={nav} onClick={onClose} aria-label={expanded ? "Close thread" : "Close browser"}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
      <div ref={holder} className="relative min-w-0 flex-1 bg-canvas">
        {!desktop ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Icon name="globe" size={28} className="text-faint" />
            <p className="text-[13px] text-muted">The browser pane runs in the desktop app.</p>
            <code className="rounded bg-sunken px-2 py-1 font-mono text-[12px] text-ink">npm run desktop</code>
          </div>
        ) : (
          !state.url && (
            <div className="flex h-full items-center justify-center px-8 text-center text-[13px] text-faint">
              Nothing open yet
            </div>
          )
        )}
      </div>
      {rail}
      </div>
    </section>
  );
}

// The address bar: the app's name as a placeholder when the page is a saved app, the URL when it isn't,
// mono for a URL, sans for a name. Focusing it switches to the real URL so a user can edit it.
function AddressInput({
  desktop,
  url,
  app,
}: {
  desktop: boolean;
  url: string | undefined;
  app: ReturnType<typeof appFor> | undefined;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function go(raw: string) {
    const next = raw.trim();
    if (next) void window.weft?.browser.open(next);
  }
  const value = draft ?? (url ? paneAddress(app, url) : url);
  const isName = draft === null && app !== undefined && url !== undefined && url.startsWith("file:");
  return (
    <input
      value={value}
      onFocus={(e) => {
        setDraft(url ?? null);
        e.currentTarget.select();
      }}
      onBlur={() => setDraft(null)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          go(e.currentTarget.value);
          e.currentTarget.blur();
        }
      }}
      disabled={!desktop}
      placeholder="Type a URL, or ask an agent to open one"
      className={`mx-1 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2.5 py-1 text-[12px] text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-accent ${isName ? "font-sans" : "font-mono"}`}
    />
  );
}
