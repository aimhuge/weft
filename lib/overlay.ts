import { useEffect, useLayoutEffect, useSyncExternalStore, type RefObject } from "react";

// The browser pane's page is a native Electron view drawn above the board's DOM, so nothing in the
// board can sit on top of it. Two kinds of thing need to deal with that:
//
//   - A full-window overlay (a dialog, an image opened full size) covers the whole window, so the
//     page has to go away entirely while it is up. `useOverlay` counts those.
//   - A local menu (a toolbar dropdown) covers a small rectangle. The page does not have to go; it
//     only has to keep out of the menu's way. `useLocalMenu` counts those, and the menu publishes
//     the rectangle it covers so the page can step aside around it.
//
// The two counters are separate: a dropdown in a card's header must not blank the page, and a
// dialog must blank it even while a dropdown is open.

export type Box = { x: number; y: number; width: number; height: number };

// A counter over the mounted things, and the listeners watching it.
function counter() {
  let open = 0;
  const listeners = new Set<() => void>();
  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function change(by: number) {
    open += by;
    for (const listener of listeners) listener();
  }
  return { subscribe, change, get: () => open > 0 };
}

const overlays = counter();
const menus = counter();

// Full-window overlays opened deep in the tree (an image opened full size). The browser pane is a native
// view drawn above the page, so it hides while any of these is up.
export function useOverlay(active: boolean) {
  useEffect(() => {
    if (!active) return;
    overlays.change(1);
    return () => overlays.change(-1);
  }, [active]);
}

// Whether any full-window overlay is up.
export function useAnyOverlay(): boolean {
  return useSyncExternalStore(overlays.subscribe, overlays.get, () => false);
}

// The rectangle the open local menu covers, or null when none is up.
let cover: Box | null = null;
const coverListeners = new Set<() => void>();

// Sets the rectangle the open menu covers. Called by `useMenuCover`, and directly by tests.
export function setLocalMenuCover(next: Box | null) {
  const same =
    cover === next ||
    (!!cover && !!next && cover.x === next.x && cover.y === next.y && cover.width === next.width && cover.height === next.height);
  if (same) return;
  cover = next;
  for (const listener of coverListeners) listener();
}

export function localMenuCover(): Box | null {
  return cover;
}

// The rectangle the open menu covers, for the browser pane to step aside around.
export function useMenuCover(): Box | null {
  return useSyncExternalStore(
    (listener) => {
      coverListeners.add(listener);
      return () => {
        coverListeners.delete(listener);
      };
    },
    localMenuCover,
    () => null,
  );
}

// A small menu (a toolbar dropdown) that is open over the page. The page stays visible while a
// menu is open: only the part under the menu is stepped over.
export function useLocalMenu(active: boolean) {
  useEffect(() => {
    if (!active) return;
    menus.change(1);
    return () => menus.change(-1);
  }, [active]);
}

// Whether any local menu is open.
export function useAnyLocalMenu(): boolean {
  return useSyncExternalStore(menus.subscribe, menus.get, () => false);
}

// Publishes the rectangle an open menu covers, so the page can step aside around it, and takes it
// back when the menu closes. The menu measures itself: a layout effect runs after the browser has
// laid it out, so the rectangle is the one on screen. The menu is passed as a ref, because the
// element only exists once the menu is open.
export function useMenuCoverPublisher(menu: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const element = menu.current;
    if (!active || !element) {
      setLocalMenuCover(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    setLocalMenuCover({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    return () => setLocalMenuCover(null);
  }, [menu, active]);
}
