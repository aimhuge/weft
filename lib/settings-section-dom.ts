import { sectionsOf, type SettingsSection } from "./settings-search";
import type { SettingsPage } from "./settings-nav";

// The DOM half of Settings' section nav: finding a section's heading on the open page, which of the page's
// sections are drawn right now, and which one the scroll has reached.

// The section's heading on the page: an h3 (or Sync's h4) whose text is the section's title.
export function findHeading(root: ParentNode, title: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>("h3, h4")) {
    if (el.textContent.trim() === title) return el;
  }
  return null;
}

// The page's sections that are on screen now, in the order the page draws them.
export function presentSections(root: ParentNode, page: SettingsPage): SettingsSection[] {
  return sectionsOf(page).filter((s) => findHeading(root, s.title));
}

// The last section whose heading has scrolled up to the line under the sticky nav (`top` is that line, in the same
// coordinates as getBoundingClientRect); the first section while none has, and none for an empty list.
export function activeSection(root: ParentNode, titles: string[], top: number): string | null {
  let active: string | null = titles[0] ?? null;
  for (const title of titles) {
    const el = findHeading(root, title);
    if (el && el.getBoundingClientRect().top <= top + 1) active = title;
  }
  return active;
}

// The card a heading sits in, for the flash after a jump: a SettingsCard or one of Sync's sections.
export const cardOf = (heading: HTMLElement): HTMLElement => heading.closest<HTMLElement>("[data-settings-card]") ?? heading;

// A short accent ring around the card a jump landed on, so your eye finds it. Web Animations, so nothing to clean up.
export function flash(el: HTMLElement) {
  if (typeof el.animate !== "function") return;
  el.animate(
    [{ boxShadow: "0 0 0 2px var(--accent)" }, { boxShadow: "0 0 0 2px var(--accent)", offset: 0.6 }, { boxShadow: "0 0 0 0 transparent" }],
    { duration: 1400, easing: "ease-out" },
  );
}
