"use client";

// The admin pages' top bar. In the desktop app on a Mac it doubles as the title bar: it leaves room for the
// window's traffic lights (which otherwise sit on "← Board") and drags the window, like the board's header.

import { useMacTitleBar } from "@/lib/use-title-bar-zoom";

export default function AdminBar({ children }: { children: React.ReactNode }) {
  const mac = useMacTitleBar();
  return (
    <header
      className={`sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-line bg-panel/90 text-[13px] backdrop-blur ${mac ? "app-drag mac-title-bar pr-5" : "px-5 py-2"}`}
    >
      {children}
    </header>
  );
}
