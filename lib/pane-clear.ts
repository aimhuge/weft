import type { Box } from "./float-place";

// The browser pane's page is a native Electron view drawn above the board's DOM, so a menu that
// opens over the page cannot be painted on top of it: CSS z-index does not reach a sibling view.
// Instead the page steps aside around the menu.
//
// The page is one rectangle and the menu is another, and the menu usually hangs off the pane's
// toolbar into the page's top corner. The page keeps the largest part of itself that does not
// overlap the menu:
//
//   - the menu reaches the page's right edge: the page keeps the strip below the menu
//   - the menu reaches the page's left edge: the page keeps the strip to the menu's right
//   - the menu sits inside the page's width: the page keeps the strip to the menu's left
//
// A menu that covers the page outright leaves nothing to show, so the page goes away.

// Whether two boxes share any area.
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// The page's box with the menu's rectangle cut out of it, or null when the menu covers it all.
// `box` is the page's own box; `menu` the rectangle the menu covers, in the same coordinates.
export function clearOfMenu(box: Box, menu: Box | null): Box | null {
  if (!menu || !overlaps(box, menu)) return box;

  const menuRight = menu.x + menu.width;
  const menuBottom = menu.y + menu.height;
  const pageRight = box.x + box.width;
  const pageBottom = box.y + box.height;

  // The menu reaches the page's right edge: the page keeps the strip below the menu.
  if (menuRight >= pageRight) {
    const height = pageBottom - menuBottom;
    return height > 0 ? { x: box.x, y: menuBottom, width: box.width, height } : null;
  }
  // The menu reaches the page's left edge: the page keeps the strip to the menu's right.
  if (menu.x <= box.x) {
    const width = pageRight - menuRight;
    return width > 0 ? { x: menuRight, y: box.y, width, height: box.height } : null;
  }
  // The menu sits inside the page's width: the page keeps the strip to the menu's left.
  return { ...box, width: menu.x - box.x };
}
