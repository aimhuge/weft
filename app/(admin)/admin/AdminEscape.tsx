"use client";

// Esc on an /admin page goes back to the board, like closing a drawer. In a text field Esc only blurs it, so
// clearing a search or backing out of a coupon form doesn't throw the SuperAdmin off the page. Only a field you
// type into counts: a focused checkbox, radio, select or button (a filter just ticked, a setting just toggled)
// used to swallow the first Esc the same way, which read as Esc not working.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Inputs you click rather than type into.
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NOT_TYPED.has(target.type);
}

export default function AdminEscape() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isTyping(e.target)) {
        (e.target as HTMLElement).blur();
        return;
      }
      router.push("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}
