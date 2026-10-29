// Threads see and drive the board window (appView) the way they drive the browser pane: mcp__board_view__*
// (lib/board-view-tools.ts) calls these routes on the pane's token-guarded control server. Only the operations
// below run, each a fixed page script with its selector JSON-encoded in; there's no route for arbitrary JS.
// Secret values stay out of reach: anything marked data-secret (a revealed vault value, the value field) reads
// as ‹secret› and is blanked in screenshots, and controls marked data-secret-action (reveal, copy) can't be
// clicked from here, so a thread can't put a value on the clipboard either (docs/architecture/board-view.md).

const SECRET = "[data-secret]";
const SECRET_ACTION = "[data-secret-action]";
// Controls that grant a thread more power (permission answers, folder grants, the mode picker, Settings): a thread
// clicking or typing there would approve itself, so only the user can (pentest 2026-10-20, P-1).
const HUMAN_ONLY = "[data-human-only]";
const REDACTED = "‹secret›";
const HIGHLIGHT_ID = "__weft_board_highlight";

const { findExpression } = require("./pane-selector.cjs");

// The routes, and nothing else: the allowlist the tests pin.
const OPERATIONS = ["screenshot", "click", "hover", "type", "read"];

// Painted over data-secret for the length of a capture: no text, no caret, a hatched block where the value was.
const BLANK_SECRETS_CSS = `${SECRET}, ${SECRET} * { color: transparent !important; caret-color: transparent !important; text-shadow: none !important; -webkit-text-security: disc !important; }
${SECRET} { background: repeating-linear-gradient(45deg, #8884 0 4px, #8882 4px 8px) !important; }
${SECRET} * { visibility: hidden !important; }`;

function selectorArg(selector, required = true) {
  const s = typeof selector === "string" ? selector.trim() : "";
  if (!s) {
    if (required) throw new Error("A CSS selector is required.");
    return "";
  }
  if (s.length > 500) throw new Error("That selector is too long (500 characters at most).");
  return s;
}

const q = (value) => JSON.stringify(value);
// The element a selector names, with the same text pseudo-classes the browser tools take
// (:text-is("Settings…"), :has-text("Save")); the page finds it by reading text (electron/pane-selector.cjs).
const find = (sel) => `const el = (${findExpression(sel)}); if (!el) return { found: false };`;

// The page side of each operation: a selector in, a small JSON-able answer out.
const scripts = {
  // Where the element's middle sits (scrolled into view), for a real mouse move.
  locate: (sel) =>
    `(() => { ${find(sel)} el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  // A click preflight: gate the markers, find the element's centre, and hit-test what's actually on
  // top there. Returns ok only when the trusted click main sends will land on the selected element
  // itself (or a descendant) — a tooltip, popover or other button layered over it would otherwise
  // receive a trusted click the selector never named (pentest 2026-10-20, P-1). No click happens here;
  // main sends real mouse events so the event is trusted.
  click: (sel) =>
    `(() => { ${find(sel)} if (el.closest(${q(SECRET_ACTION)})) return { found: true, refused: true }; if (el.closest(${q(HUMAN_ONLY)})) return { found: true, humanOnly: true }; el.scrollIntoView({ block: "nearest" });` +
    ` const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;` +
    ` const top = document.elementFromPoint(x, y);` +
    ` if (!top || !(top === el || el.contains(top))) return { found: true, covered: true };` +
    ` return { found: true, x, y }; })()`,
  // Locates a field without focusing it (the trusted-focus path runs in main, so a phantom focus event
  // can't out-think the HUMAN_ONLY gate above). Returns whether the element is an editable field.
  isField: (sel) =>
    `(() => { ${find(sel)} if (el.closest(${q(HUMAN_ONLY)})) return { found: true, humanOnly: true }; if (!el.matches("input, textarea, [contenteditable]:not([contenteditable='false'])")) return { found: true, refused: true }; return { found: true }; })()`,
  // Focuses a field and selects what's in it, so the typing that follows replaces it.
  focusField: (sel) =>
    `(() => { ${find(sel)} if (el.closest(${q(HUMAN_ONLY)})) return { found: true, humanOnly: true }; if (!el.matches("input, textarea, [contenteditable]:not([contenteditable='false'])")) return { found: true, refused: true }; el.focus(); if (typeof el.select === "function") el.select(); else document.execCommand("selectAll"); return { found: true }; })()`,
  // The element's visible text with every data-secret value inside the page cut out.
  read: (sel) =>
    `(() => { const el = ${sel ? `(${findExpression(sel)})` : "document.body"}; if (!el) return { found: false };` +
    ` if (el.closest(${q(SECRET)})) return { found: true, text: ${q(REDACTED)} }; let text = el.innerText || "";` +
    ` for (const s of document.querySelectorAll(${q(SECRET)})) { const v = String(s.value || s.innerText || s.textContent || "").trim(); if (v) text = text.split(v).join(${q(REDACTED)}); }` +
    ` return { found: true, text: text.slice(0, 30000) }; })()`,
  highlight: (sel) =>
    `(() => { ${find(sel)} el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); const box = document.createElement("div"); box.id = ${q(HIGHLIGHT_ID)};` +
    ` box.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #e8542f;border-radius:8px;box-shadow:0 0 0 4px rgb(232 84 47/.25);left:" + (r.left - 6) + "px;top:" + (r.top - 6) + "px;width:" + (r.width + 6) + "px;height:" + (r.height + 6) + "px";` +
    ` document.documentElement.appendChild(box); return { found: true }; })()`,
  unhighlight: () => `document.getElementById(${q(HIGHLIGHT_ID)})?.remove()`,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// board() is the board's webContents (appView's), or undefined before it exists.
function createBoardView({ board }) {
  function contents() {
    const wc = board();
    if (!wc || wc.isDestroyed() || !wc.getURL()) throw new Error("The board isn't loaded yet.");
    return wc;
  }

  function miss(selector) {
    return new Error(`No element on the board matches ${selector}`);
  }

  function humanOnly(selector) {
    return new Error(`${selector} answers a permission, grants access or changes settings; only you can do that, so ask the user.`);
  }

  function covered(selector) {
    return new Error(`Something is on top of ${selector} at its centre; ask the user to close it or click it themselves.`);
  }

  async function screenshot(highlight) {
    const wc = contents();
    const sel = selectorArg(highlight, false);
    const cssKey = await wc.insertCSS(BLANK_SECRETS_CSS);
    let found;
    try {
      if (sel) found = (await wc.executeJavaScript(scripts.highlight(sel))).found;
      // Let the blanking, the scroll and the box paint before the capture.
      await wait(120);
      let image = await wc.capturePage();
      if (image.isEmpty()) throw new Error("The board window captured empty (is it minimized or hidden?).");
      if (image.getSize().width > 1600) image = image.resize({ width: 1600 });
      return { png: image.toPNG().toString("base64"), ...(sel ? { found: Boolean(found) } : {}) };
    } finally {
      if (found) await wc.executeJavaScript(scripts.unhighlight()).catch(() => {});
      await wc.removeInsertedCSS(cssKey).catch(() => {});
    }
  }

  async function click(selector) {
    const sel = selectorArg(selector);
    const wc = contents();
    // Page-side gate first: any element under a data-human-only or data-secret-action marker is
    // refused. The markers cover permission answers, folder Allow/Always, the mode picker, Settings,
    // the question form, the reply box, and the secret reveal/copy buttons. The preflight also
    // runs elementFromPoint at the selected element's centre and refuses unless the hit test is
    // the selected element or one of its descendants: an overlapping tooltip, popover or layered
    // button would otherwise receive the trusted click the selector never named.
    const r = await wc.executeJavaScript(scripts.click(sel));
    if (!r.found) throw miss(sel);
    if (r.humanOnly) throw humanOnly(sel);
    if (r.refused) throw new Error(`${sel} reveals or copies a secret value; only you can click that (with Touch ID).`);
    if (r.covered) throw covered(sel);
    // Real, trusted mouse events. element.click() inside executeJavaScript would be untrusted and any
    // allow handler that gates on `e.isTrusted` would still let it through (pentest 2026-10-20, P-1).
    const zoom = wc.getZoomFactor();
    const x = Math.round(r.x * zoom);
    const y = Math.round(r.y * zoom);
    wc.sendInputEvent({ type: "mouseMove", x, y });
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
    return { clicked: sel };
  }

  // A real mouse move, so CSS :hover (a row's hover buttons) and mouseenter handlers fire.
  async function hover(selector) {
    const sel = selectorArg(selector);
    const wc = contents();
    const r = await wc.executeJavaScript(scripts.locate(sel));
    if (!r.found) throw miss(sel);
    const zoom = wc.getZoomFactor();
    const x = Math.round(r.x * zoom);
    const y = Math.round(r.y * zoom);
    wc.sendInputEvent({ type: "mouseMove", x, y });
    return { hovered: sel, x, y };
  }

  async function type(selector, text) {
    const sel = selectorArg(selector);
    const wc = contents();
    const r = await wc.executeJavaScript(scripts.focusField(sel));
    if (!r.found) throw miss(sel);
    if (r.humanOnly) throw humanOnly(sel);
    if (r.refused) throw new Error(`${sel} isn't a text field.`);
    await wc.insertText(String(text ?? ""));
    return { typed: sel };
  }

  async function read(selector) {
    const sel = selectorArg(selector, false);
    const wc = contents();
    const r = await wc.executeJavaScript(scripts.read(sel));
    if (!r.found) throw miss(sel);
    return { url: wc.getURL(), title: wc.getTitle(), text: r.text };
  }

  return { screenshot, click, hover, type, read };
}

function boardViewRoutes(view) {
  return {
    "POST /board-view/screenshot": (body) => view.screenshot(body.highlight),
    "POST /board-view/click": (body) => view.click(body.selector),
    "POST /board-view/hover": (body) => view.hover(body.selector),
    "POST /board-view/type": (body) => view.type(body.selector, body.text),
    "POST /board-view/read": (body) => view.read(body.selector),
  };
}

module.exports = { createBoardView, boardViewRoutes, scripts, OPERATIONS, BLANK_SECRETS_CSS, REDACTED, HUMAN_ONLY };
