// Is this page the desktop board (the Electron window, or the board opened in a browser on this Mac) rather
// than weft.zip? Both serve the same app/, so a boundary that talks about ~/.weft and threads (app/error.tsx)
// asks this first. Browser-only: it reads window.
export function isLocalBoard(win: Pick<Window, "location"> & { weft?: unknown } = window): boolean {
  if (win.weft) return true;
  const host = win.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
