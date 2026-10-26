// The vault's fill (electron/pane-secrets.cjs): wc is the page's webContents. Answers { found } so a selector
// that matches nothing reads as a miss, not an error. The element is found the one way the agent tools find
// theirs (electron/pane-element.cjs), so a selector means the same field in both.

const { callOn, FOCUS, resolveElement } = require("./pane-element.cjs");

// Replaces the field's contents: select all, then insert as if typed, so the page's own input handlers run.
async function typeText(cdp, wc, selector, text) {
  const el = await resolveElement(cdp, wc, { selector });
  if (!el) return { found: false };
  await callOn(cdp, wc, el, FOCUS);
  await wc.insertText(String(text));
  return { found: true };
}

module.exports = { typeText };
