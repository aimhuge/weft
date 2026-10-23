// Shared setup for component tests (components/*.test.tsx, run in jsdom): jest-dom matchers,
// unmounting between tests, and a card factory.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import type { Card } from "@/lib/types";

// Vitest runs without globals, so Testing Library can't register its own cleanup.
afterEach(cleanup);

// jsdom has no matchMedia, which Electron always has: a stand-in that matches nothing (a test can vi.stubGlobal its own).
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

// jsdom has no scrollIntoView, which the board's shared views call to keep a row in view (the project
// bar's selected chip, the palette's active row, a thread's turn). Without it they throw and the error
// boundary swallows the whole panel, so every component test gets a no-op.
if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

export function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    title: "Fix the login page",
    prompt: "Fix the login page",
    cwd: "/Users/me/dev/app",
    backend: "claude",
    permissionMode: "auto",
    column: "review",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}
