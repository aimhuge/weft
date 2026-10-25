"use client";

import { useEffect, useId, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { coverIntros } from "@/lib/intro-cover";
import { NO_DRAG } from "@/lib/no-drag";
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

// The chrome every dialog shares: a dimmed backdrop over the whole window, a panel, a header with the
// title and a close button, and Escape. Escape always closes the newest dialog; so does a click on the
// backdrop, unless `keepOnBackdrop`. Without a title there's no header, and `label` names the dialog.
// The body sits in a CrashGuard, so a dialog that fails to draw still has its header, ✕ and Escape.
// Opening one pauses a feature intro that is playing under it (lib/intro-cover.ts).
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
  layer?: keyof typeof LAYER;
  // Width and height for the panel, e.g. "w-full max-w-[560px]".
  className?: string;
  style?: CSSProperties;
  // Makes the header a drag handle (presses on its buttons are left alone).
  onHeaderPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  useEscape(true, onClose);
  useEffect(coverIntros, []);

  return (
    <div
      style={NO_DRAG}
      className={`fixed inset-0 ${LAYER[layer]} bg-black/40 ${PLACEMENT[placement]}`}
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
          {children}
        </CrashGuard>
      </div>
    </div>
  );
}
