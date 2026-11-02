"use client";

// The board's right-click menus on weft.zip. The desktop shows them natively (electron/main.cjs popupMenu): the board
// builds the items (lib/card-menu.ts) and gets back the id picked. A browser tab has no native menu, so this draws the
// same items at the pointer and answers the same way, and useBoardMenus (components/use-board-menus.ts) runs as it does
// on the desktop. One menu at a time; Escape, a click outside or a scroll closes it with nothing picked.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { MenuItem } from "@/lib/card-menu";

interface Open {
  items: MenuItem[];
  x: number;
  y: number;
  pick: (id: string | null) => void;
}

// Where the last right-click (or click) was, so the menu opens under the pointer.
function useLastPointer() {
  const at = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const note = (e: MouseEvent) => {
      at.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("contextmenu", note, true);
    document.addEventListener("mousedown", note, true);
    return () => {
      document.removeEventListener("contextmenu", note, true);
      document.removeEventListener("mousedown", note, true);
    };
  }, []);
  return at;
}

export function useWebMenu(): { popup: (items: MenuItem[]) => Promise<string | null>; menu: ReactNode } {
  const at = useLastPointer();
  const [open, setOpen] = useState<Open | null>(null);
  const popup = useCallback(
    (items: MenuItem[]) =>
      new Promise<string | null>((resolve) => {
        setOpen((prev) => {
          prev?.pick(null);
          return {
            items,
            ...at.current,
            pick: (id) => {
              setOpen(null);
              resolve(id);
            },
          };
        });
      }),
    [at],
  );
  return { popup, menu: open ? <WebMenu {...open} /> : null };
}

// Kept inside the window: a menu opened near the right or bottom edge opens to the left or up.
function placed(x: number, y: number, el: HTMLElement | null) {
  const w = el?.offsetWidth ?? 0;
  const h = el?.offsetHeight ?? 0;
  return { left: Math.max(4, Math.min(x, window.innerWidth - w - 4)), top: Math.max(4, Math.min(y, window.innerHeight - h - 4)) };
}

function WebMenu({ items, x, y, pick }: Open) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    setPos(placed(x, y, box.current));
    box.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const close = () => pick(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [x, y, pick]);

  return (
    <div
      ref={box}
      role="menu"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] min-w-[200px] max-w-[320px] rounded-lg border border-line-strong bg-panel py-1 text-[12.5px] text-ink shadow-2xl"
    >
      {items.map((item, i) =>
        "id" in item ? (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.enabled === false}
            onClick={() => pick(item.id)}
            className="flex w-full items-start gap-2 px-3 py-1 text-left hover:bg-accent hover:text-on-accent focus:bg-accent focus:text-on-accent focus:outline-none disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink"
          >
            <span className="w-3 shrink-0">{item.checked ? "✓" : ""}</span>
            <span className="min-w-0 flex-1">
              {item.label}
              {item.detail && <span className="block text-[11px] opacity-70">{item.detail}</span>}
            </span>
            {item.accelerator && <span className="shrink-0 pl-3 text-[11px] opacity-60">{item.accelerator}</span>}
          </button>
        ) : (
          <div key={`sep-${i}`} role="separator" className="my-1 border-t border-line" />
        ),
      )}
    </div>
  );
}
