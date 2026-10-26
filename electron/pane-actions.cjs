// The vault's fill (electron/pane-secrets.cjs): wc is the page's webContents. Answers { found } so a selector
// that matches nothing reads as a miss, not an error. The agent tools' input is electron/pane-input.cjs.

// Replaces the field's contents: select all, then insert as if typed, so the page's own input handlers run.
async function typeText(wc, selector, text) {
  const found = await wc.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(String(selector))});
    if (!el) return false;
    el.focus();
    if (typeof el.select === "function") el.select();
    else document.execCommand("selectAll");
    return true;
  })()`);
  if (found) await wc.insertText(String(text));
  return { found };
}

module.exports = { typeText };
