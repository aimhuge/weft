import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { activeSection, cardOf, findHeading, flash, presentSections } from "./settings-section-dom";
import type { SettingsSection } from "./settings-search";
import type { SettingsPage } from "./settings-nav";

// How long a jump from search waits for its section to draw (a page whose settings are still loading) before it gives up.
export const JUMP_WAIT_MS = 3000;

// The open Settings page's sections for its top nav: which are drawn, which one the scroll is on, and a jump to one.
// Pages draw some sections late (after a fetch, once signed in), so a MutationObserver keeps the list current, and a
// jump asked for before its heading exists (search picked a section on another page) lands once it appears.
// `navRef` is the sticky nav: its bottom edge is the line a section counts as reached at, and where a jump scrolls to.
export function useSettingsSections(scrollRef: RefObject<HTMLElement | null>, navRef: RefObject<HTMLElement | null>, page: SettingsPage) {
  const [sections, setSections] = useState<SettingsSection[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const pending = useRef<{ title: string; until: number } | null>(null);
  // Where the last jump left the page: its chip stays lit until you scroll away from there, even when the section
  // sits too near the bottom to reach the line (the scroll the jump itself makes doesn't count).
  const landedAt = useRef<number | null>(null);

  const line = useCallback(() => {
    const root = scrollRef.current;
    const nav = navRef.current;
    return nav ? nav.getBoundingClientRect().bottom : (root?.getBoundingClientRect().top ?? 0);
  }, [scrollRef, navRef]);

  const land = useCallback(
    (title: string) => {
      const root = scrollRef.current;
      const el = root && findHeading(root, title);
      if (!root || !el) return false;
      const card = cardOf(el);
      // Scroll the page itself (not scrollIntoView, which would also scroll the window behind the dialog).
      root.scrollTop += card.getBoundingClientRect().top - line() - 8;
      landedAt.current = root.scrollTop;
      setActive(title);
      flash(card);
      return true;
    },
    [scrollRef, line],
  );

  const jump = useCallback(
    (title: string) => {
      pending.current = null;
      if (!land(title)) pending.current = { title, until: Date.now() + JUMP_WAIT_MS };
    },
    [land],
  );

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const refresh = () => {
      const now = presentSections(root, page);
      setSections((prev) => (prev.length === now.length && prev.every((s, i) => s === now[i]) ? prev : now));
      const want = pending.current;
      if (want && (Date.now() > want.until || land(want.title))) pending.current = null;
    };
    const onScroll = () => {
      if (landedAt.current !== null && Math.abs(root.scrollTop - landedAt.current) < 2) return;
      landedAt.current = null;
      const titles = presentSections(root, page).map((s) => s.title);
      // At the bottom the last sections can never reach the line, so the bottom counts as the last one.
      const atEnd = root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      setActive(atEnd ? (titles.at(-1) ?? null) : activeSection(root, titles, line()));
    };
    // A new page opens at its top.
    root.scrollTop = 0;
    landedAt.current = null;
    onScroll();
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, page, land, line]);

  return { sections, active, jump };
}
