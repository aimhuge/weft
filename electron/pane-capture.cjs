// Pictures of a browser pane page (electron/browser-pane.cjs): an agent's screenshot and a card's thumbnail.
const { highlightExpression } = require("./pane-selector.cjs");

// highlight, a CSS selector, scrolls that element into view and draws an orange box around it for the shot
// (for step-by-step instructions: "click here"), then takes the box away. The selector may carry
// Playwright's text pseudo-classes, the same way the click tools' selector does (electron/pane-selector.cjs).
async function captureShot(wc, highlight) {
  let found;
  if (highlight) {
    found = await wc.executeJavaScript(highlightExpression(String(highlight))).catch(() => false);
    // Let the scroll and the box paint before the capture.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  let image;
  try {
    image = await wc.capturePage();
  } finally {
    if (found) await wc.executeJavaScript(`document.getElementById("__weft_highlight")?.remove()`).catch(() => {});
  }
  if (image.getSize().width > 1280) image = image.resize({ width: 1280 });
  return { png: image.toPNG().toString("base64"), ...(highlight ? { found: Boolean(found) } : {}) };
}

// A card's thumbnail (lib/card-pictures.ts): a small capture that never shows the pane. A page that
// isn't on screen may capture empty; that's no thumbnail, not an error.
async function captureThumb(wc) {
  if (!wc || !wc.getURL()) return { jpg: null };
  let image = await wc.capturePage();
  if (image.isEmpty()) return { jpg: null };
  if (image.getSize().width > 480) image = image.resize({ width: 480, quality: "good" });
  return { jpg: image.toJPEG(78).toString("base64") };
}

module.exports = { captureShot, captureThumb };
