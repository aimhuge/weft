"use client";

import { createContext, useContext, useEffect, useId, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { coverIntros } from "@/lib/intro-cover";
import { NO_DRAG } from "@/lib/no-drag";
import { useOverlay } from "@/lib/overlay";
import { useEscape } from "@/lib/use-escape";
import CrashGuard from "./CrashGuard";
import Icon from "./Icon";

const PLACEMENT = {
  center: "flex items-center justify-center p-4",
  top: "flex items-start justify-center p-4 pt-[12vh]",
  // The panel places itself with `style` (a dialog the user moves and resizes).
  free: "",
};

// How high the dialog stacks. "top" clears everything else Weft draws (feature intros at z-[70], the
// upgrade dialog): Settings and the welcome. "palette" is above them, since ⌘K opens over Settings.
// "front" is above all of it, for the achievement popup, which can arrive (and start talking) at any
// moment. Only confetti and tooltips go higher.
const LAYER = { normal: "z-50", top: "z-[90]", palette: "z-[92]", front: "z-[94]" };
type Layer = keyof typeof LAYER;
const Z: Record<Layer, number> = { normal: 50, top: 90, palette: 92, front: 94 };

// Where the dialog this one was opened from stacks. A dialog never stacks under the one that opened it:
// Settings is on "top", and the vault's Share… dialog (a plain one) opened from Settings → Secrets used to
// come up at z-50, under Settings' backdrop, so the button looked dead. It takes the opener's layer when
// that is the higher one, and one step above it, so the order of the two hosts on the body (which
// StrictMode's double-mount can swap) doesn't decide who is on top.
const OpenedFrom = createContext<{ layer: Layer; z: number } | null>(null);

// The chrome every dialog shares: a dimmed backdrop over the whole window, a panel, a header with the
// title and a close button, and Escape. Escape always closes the newest dialog; so does a click on the
// backdrop, unless `keepOnBackdrop`. Without a title there's no header, and `label` names the dialog.
// The body sits in a CrashGuard, so a dialog that fails to draw still has its header, ✕ and Escape.
// Opening one pauses a feature intro that is playing under it (lib/intro-cover.ts), and hides the browser
// pane's page: that is a native view drawn above all of this, so no z-index can put a dialog over it
// (lib/overlay.ts). Every dialog gets that here, so a new one can't come up half under the page.
//
// It draws in a portal, not where it was asked for. A dialog opened from the header (the leagues, from
// components/LeagueBadge.tsx) sits inside <header>, and on the Mac that header is the window's drag
// region (-webkit-app-region: drag, app/globals.css), which is a stacking context: the dialog's fixed
// backdrop could only stack inside it, under the board's sheet and the rail's drawer beside it. Out on
// the body there is no such context in the way, and the z-index above is the whole story.
//
// The portal gets a div of its own rather than the body itself. React takes a portal's nodes away when
// the tree that made them unmounts, and a body shared with the rest of the page makes that bookkeeping
// ambiguous: one dialog's unmount can take another's nodes with it (the board's tests caught exactly
// that). A div of its own leaves React nothing to confuse.
//
// The host is made in a lazy initializer, but StrictMode runs an initializer twice on the same mount,
// and its double-mount also runs the cleanup, which takes the host off the body. The second call must
// therefore find the first call's host and put it back: a portal into a detached node draws nothing,
// which is why Settings (a dialog) would not open. The host is left marked as waiting for its twin,
// under the dialog's own id: without StrictMode there is no twin, and a dialog opened from this one in
// the same render (Settings arriving with Share… already up) must not take its host for one, or closing
// it would take Settings off the page too. A host still waiting when the turn ends was not claimed.
const WAITING = "data-weft-modal-waiting";

function makeHost(id: string): HTMLElement {
  const waiting = [...document.querySelectorAll<HTMLElement>(`[${WAITING}]`)].find((el) => el.getAttribute(WAITING) === id);
  if (waiting) {
    waiting.removeAttribute(WAITING);
    // The strict-mode cleanup took it off the body; the portal needs it back.
    if (!waiting.isConnected) document.body.appendChild(waiting);
    return waiting;
  }
  const made = document.createElement("div");
  made.dataset.weftModal = "";
  document.body.appendChild(made);
  return made;
}

function offerHost(made: HTMLElement, id: string) {
  made.setAttribute(WAITING, id);
  // The second StrictMode call comes before the turn ends; a host still waiting then was not claimed.
  queueMicrotask(() => made.removeAttribute(WAITING));
}

// The host this dialog draws into: a div of its own on the body (see the note above). The initializer
// leaves the host it made waiting, so the second call under StrictMode takes that same host rather than
// making a second one.
function useHost(id: string): HTMLElement {
  const [host] = useState(() => {
    const made = makeHost(id);
    offerHost(made, id);
    return made;
  });
  // StrictMode's double-mount runs this cleanup between the two mounts, which takes the host off the
  // body; the second mount puts it back. A portal into a detached node draws nothing, which is why
  // the dialog would not open.
  useEffect(() => {
    if (!host.isConnected) document.body.appendChild(host);
    return () => host.remove();
  }, [host]);
  return host;
}

// Where this dialog stacks: its own layer, or its opener's when that is higher, and a step above the opener.
function useStacking(layer: Layer): { at: Layer; z: number; style: CSSProperties } {
  const opener = useContext(OpenedFrom);
  if (!opener) return { at: layer, z: Z[layer], style: NO_DRAG };
  const at = Z[opener.layer] > Z[layer] ? opener.layer : layer;
  const z = Math.max(Z[at], opener.z + 1);
  return { at, z, style: { ...NO_DRAG, zIndex: z } };
}

export default function Modal({
  title,
  label,
  onClose,
  placement = "center",
  keepOnBackdrop = false,
  layer = "normal",
  className = "",
  style,
  onHeaderPointerDown,
  children,
}: {
  title?: ReactNode;
  label?: string;
  onClose: () => void;
  placement?: keyof typeof PLACEMENT;
  keepOnBackdrop?: boolean;
  layer?: Layer;
  // Width and height for the panel, e.g. "w-full max-w-[560px]".
  className?: string;
  style?: CSSProperties;
  // Makes the header a drag handle (presses on its buttons are left alone).
  onHeaderPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const { at, z, style: stacked } = useStacking(layer);
  const host = useHost(titleId);
  useEscape(true, onClose);
  useEffect(coverIntros, []);
  useOverlay(true);

  const dialog = (
    <div
      style={stacked}
      className={`fixed inset-0 ${LAYER[at]} bg-black/40 ${PLACEMENT[placement]}`}
      onMouseDown={keepOnBackdrop ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        onMouseDown={(e) => e.stopPropagation()}
        style={style}
        className={`flex flex-col rounded-xl border border-line bg-panel shadow-2xl ${placement === "free" ? "absolute" : ""} ${className}`}
      >
        {title && (
          <div
            onPointerDown={
              onHeaderPointerDown && ((e) => !(e.target as HTMLElement).closest("button") && onHeaderPointerDown(e))
            }
            style={onHeaderPointerDown ? { touchAction: "none" } : undefined}
            className={`flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5 ${
              onHeaderPointerDown ? "cursor-move select-none" : ""
            }`}
          >
            <h2 id={titleId} className="text-[15px] font-medium text-ink">
              {title}
            </h2>
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
              <Icon name="x" size={16} />
            </button>
          </div>
        )}
        <CrashGuard what="dialog" name={typeof title === "string" ? title : label} className="m-4">
          <OpenedFrom.Provider value={{ layer: at, z }}>{children}</OpenedFrom.Provider>
        </CrashGuard>
      </div>
    </div>
  );

  return createPortal(dialog, host);
}
