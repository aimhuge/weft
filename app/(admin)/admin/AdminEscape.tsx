"use client";

// Esc on an /admin page goes back to the board, like closing a drawer. In a text field Esc only blurs it, so
// clearing a search or backing out of a coupon form doesn't throw the SuperAdmin off the page. Only a field you
// type into counts: a focused checkbox, radio, select or button (a filter just ticked, a setting just toggled)
// used to swallow the first Esc the same way, which read as Esc not working.
//
// This is the page's own layer of the repo's Escape stack (lib/use-escape.ts), so a drawer open on top of it
// (the Users page's activity drawer) takes the key first and this only answers once the drawer is gone.

import { useRouter } from "next/navigation";
import { useEscape } from "@/lib/use-escape";

// Inputs you click rather than type into.
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !NOT_TYPED.has(target.type);
}

export default function AdminEscape() {
  const router = useRouter();
  useEscape(true, (e) => {
    if (isTyping(e.target)) {
      (e.target as HTMLElement).blur();
      return;
    }
    router.push("/");
  });
  return null;
}
