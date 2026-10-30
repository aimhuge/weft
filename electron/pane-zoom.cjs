// The browser pane's page zoom (electron/browser-pane.cjs): the toolbar's zoom menu, ⌘+/−/0, ⌘+scroll.

// Chrome's zoom steps, as percentages; Zoom In/Out walk them.
const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];

// The next step up (dir 1) or down (dir -1) from a zoom that may sit between steps.
function stepZoom(percent, dir) {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > percent + 0.5) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((z) => z < percent - 0.5) ?? ZOOM_STEPS[0];
}

// action is "in", "out", "reset", or a percentage. Chromium shares zoom across a host's pages.
// True when it set a zoom.
function zoomContents(wc, action) {
  if (!wc || wc.isDestroyed()) return false;
  const now = wc.getZoomFactor() * 100;
  const next =
    action === "in" ? stepZoom(now, 1) : action === "out" ? stepZoom(now, -1) : action === "reset" ? 100 : Number(action);
  if (!Number.isFinite(next)) return false;
  wc.setZoomFactor(Math.min(500, Math.max(25, next)) / 100);
  return true;
}

module.exports = { ZOOM_STEPS, stepZoom, zoomContents };
