"use client";

// Esc on an /admin page goes back to the board, like closing a drawer. In a text field Esc only blurs it, so
// clearing a search or backing out of a coupon form doesn't throw the SuperAdmin off the page.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
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
