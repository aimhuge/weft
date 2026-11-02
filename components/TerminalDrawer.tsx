"use client";

import { useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import Icon from "./Icon";

// The board's terminal: real shells (electron/terminal.cjs) in a drawer along the bottom of the window,
// for the commands a thread can't or shouldn't run. Each folder has its own shells, keyed by its path, so
// picking another project or card switches to them; the others keep running, as they do while the drawer
// is closed. A folder's shell splits side by side, VS Code style, up to MAX_PANES.

const MIN_HEIGHT = 120;
const MAX_PANES = 3;

// Each folder's panes, kept for the app's life so switching folders and back keeps its splits. The first
// pane's shell id is the folder itself; splits add "<folder>#<n>".
const panesByFolder = new Map<string, string[]>();
let nextSplit = 2;

export default function TerminalDrawer({
  cwd,
  height,
  onHeight,
  onClose,
}: {
  // The folder whose shells to show: the open card's, else the selected project's.
  cwd: string;
  height: number;
  onHeight: (height: number) => void;
  onClose: () => void;
}) {
  const [panes, setPanesState] = useState<string[]>(() => panesByFolder.get(cwd) ?? [cwd]);
  const [focused, setFocused] = useState(panes[0] ?? cwd);
  const bridge = typeof window === "undefined" ? undefined : window.weft;

  function setPanes(next: string[]) {
    panesByFolder.set(cwd, next);
    setPanesState(next);
  }

  function split() {
    if (panes.length >= MAX_PANES) return;
    const id = `${cwd}#${nextSplit++}`;
    const at = panes.indexOf(focused) + 1 || panes.length;
    setPanes([...panes.slice(0, at), id, ...panes.slice(at)]);
    setFocused(id);
  }

  function closePane(id: string) {
    bridge?.terminal.kill(id);
    const rest = panes.filter((p) => p !== id);
    // The last pane closing hides the drawer; reopening starts a fresh shell.
    if (rest.length === 0) {
      panesByFolder.delete(cwd);
      onClose();
      return;
    }
    setPanes(rest);
    const previous = rest[Math.max(0, panes.indexOf(id) - 1)];
    if (focused === id && previous) setFocused(previous);
  }

  function startDrag(e: React.PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const move = (ev: PointerEvent) => {
      const max = window.innerHeight - 160;
      onHeight(Math.max(MIN_HEIGHT, Math.min(max, startHeight + startY - ev.clientY)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const canSplit = panes.length < MAX_PANES;

  // data-human-only: the shell has none of a thread's guards, so board_view can't click or type in it
  // (docs/architecture/board-view.md); electron/board-view.cjs refuses any xterm on top of the mark.
  return (
    <section data-human-only style={{ height }} className="relative flex shrink-0 flex-col border-t border-line-strong bg-[#16161a]">
      <div onPointerDown={startDrag} className="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize" aria-hidden="true" />
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1 text-[11.5px] text-zinc-400">
        <Icon name="terminal" size={13} />
        <span className="font-medium text-zinc-200">Terminal</span>
        <span title={cwd} className="min-w-0 truncate">{shortPath(cwd)}</span>
        <div className="flex-1" />
        <button
          onClick={split}
          disabled={!canSplit}
          title={canSplit ? "Split the terminal (⌘\\)" : `Up to ${MAX_PANES} terminals`}
          className="rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Split
        </button>
        <button onClick={onClose} title="Hide (the shells keep running)" aria-label="Hide terminal" className="rounded p-0.5 hover:bg-white/10 hover:text-zinc-100">
          <Icon name="x" size={13} />
        </button>
      </div>
      {bridge?.terminal ? (
        <div className="flex min-h-0 flex-1">
          {panes.map((id, i) => (
            <TerminalPane
              key={id}
              id={id}
              cwd={cwd}
              divided={i > 0}
              closable={panes.length > 1}
              onFocus={() => setFocused(id)}
              onSplit={split}
              onClose={() => closePane(id)}
            />
          ))}
        </div>
      ) : (
        <p className="p-3 text-[12px] text-zinc-400">
          {/* The board hot-reloads in dev, but the preload only loads with the app, so a running Weft lacks it. */}
          {bridge ? "Quit Weft (⌘Q) and open it again to load the terminal." : "The terminal needs the Weft desktop app."}
        </p>
      )}
    </section>
  );
}

// One shell, drawn with xterm. Restart and close sit on its corner while the pointer is over it.
function TerminalPane({
  id,
  cwd,
  divided,
  closable,
  onFocus,
  onSplit,
  onClose,
}: {
  id: string;
  cwd: string;
  divided: boolean;
  closable: boolean;
  onFocus: () => void;
  onSplit: () => void;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [exited, setExited] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // xterm keeps the handlers from its first render; these refs hand it the current ones.
  const handlers = useRef({ onFocus, onSplit });
  useEffect(() => {
    handlers.current = { onFocus, onSplit };
  });

  useEffect(() => {
    const bridge = window.weft;
    if (!bridge?.terminal || !host.current) return;
    const el = host.current;
    let disposed = false;
    // Read through a call: the async setup below checks it after each await, once cleanup may have run.
    const isDisposed = () => disposed;
    const cleanups: (() => void)[] = [];

    void (async () => {
      // xterm touches the DOM as it loads, so it can't be imported on the server.
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (isDisposed()) return;
      const term = new Terminal({
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 12.5,
        cursorBlink: true,
        allowProposedApi: true,
        macOptionIsMeta: true,
        scrollback: 5000,
        theme: { background: "#16161a", foreground: "#e4e4e7", cursor: "#e4e4e7", selectionBackground: "#3f3f46" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fit.fit();
      cleanups.push(() => term.dispose());

      // ⌘\ splits, as in VS Code.
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && e.metaKey && e.key === "\\") {
          handlers.current.onSplit();
          return false;
        }
        return true;
      });
      const onFocusIn = () => handlers.current.onFocus();
      el.addEventListener("focusin", onFocusIn);
      cleanups.push(() => el.removeEventListener("focusin", onFocusIn));

      cleanups.push(bridge.terminal.onData((sid, data) => sid === id && term.write(data)));
      cleanups.push(bridge.terminal.onExit((sid, code) => sid === id && setExited(code)));
      const input = term.onData((data) => bridge.terminal.write(id, data));
      cleanups.push(() => input.dispose());

      const observer = new ResizeObserver(() => {
        if (!el.offsetWidth || !el.offsetHeight) return;
        fit.fit();
        bridge.terminal.resize(id, term.cols, term.rows);
      });
      observer.observe(el);
      cleanups.push(() => observer.disconnect());

      const opened = await bridge.terminal.open(id, cwd, term.cols, term.rows);
      if (isDisposed()) return;
      if (opened.error) setError(opened.error);
      else if (opened.replay) term.write(opened.replay);
      term.focus();
    })();

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [id, cwd, generation]);

  function restart() {
    window.weft?.terminal.kill(id);
    setExited(null);
    setError(null);
    setGeneration((g) => g + 1);
  }

  return (
    <div className={`group relative flex min-w-0 flex-1 flex-col ${divided ? "border-l border-white/10" : ""}`}>
      <div ref={host} data-human-only className="min-h-0 flex-1 px-2 py-1" />
      <div className="absolute right-1.5 top-1 z-10 flex gap-0.5 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100">
        <button onClick={restart} title="Restart this shell" aria-label="Restart this shell" className="rounded bg-[#16161a] p-1 hover:bg-white/10 hover:text-zinc-100">
          <Icon name="reload" size={12} />
        </button>
        {closable && (
          <button onClick={onClose} title="Close this terminal" aria-label="Close this terminal" className="rounded bg-[#16161a] p-1 hover:bg-white/10 hover:text-zinc-100">
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {exited !== null && (
        <button onClick={restart} className="absolute bottom-2 left-3 text-[12px] text-amber-400 hover:underline">
          Shell exited ({exited}). Restart
        </button>
      )}
      {error && <p className="absolute bottom-2 left-3 text-[12px] text-red-400">Couldn&apos;t start a shell: {error}</p>}
    </div>
  );
}

function shortPath(p: string) {
  return p.replace(/^\/Users\/[^/]+/, "~");
}
