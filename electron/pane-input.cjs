// What agents do to a pane page through CDP (electron/pane-cdp.cjs): click, hover, type, press keys, scroll,
// pick an option, wait for something, change the viewport and read the accessibility snapshot. Input goes in as
// Input.dispatch* events, so the page sees trusted events (isTrusted, pointerdown, real focus), the way a person's
// would; element.click() from a script didn't reach menus that open on pointerdown or handlers that check isTrusted.
// An element is a ref from the snapshot (pane-ax.cjs) or a CSS selector. Each operation is a fixed page function;
// there's no route for arbitrary JS (docs/architecture/agent-browser.md).

const { formatAxTree } = require("./pane-ax.cjs");
const { keyEvents } = require("./pane-keys.cjs");
const { callOn, FOCUS, GROUP, resolveElement } = require("./pane-element.cjs");

const VIEWPORTS = {
  phone: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true },
};
const WAIT_DEFAULT_MS = 5000;
const WAIT_MAX_MS = 30_000;
const POLL_MS = 150;

// Scrolls the element to the middle and says where its centre is, or what's on top of it there. A label on top of
// its own input counts as the input, and so does anything inside the element (a button's icon).
const POINT = `function () {
  this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const r = this.getBoundingClientRect();
  if (!r.width && !r.height) return { hidden: true };
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  let top = document.elementFromPoint(x, y);
  while (top && top.shadowRoot) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
  if (!top || top === this || this.contains(top) || top.control === this || (top.closest && top.closest("label")?.control === this)) return { x, y };
  const name = top.tagName.toLowerCase() + (top.id ? "#" + top.id : "") + (typeof top.className === "string" && top.className.trim() ? "." + top.className.trim().split(/\\s+/)[0] : "");
  return { x, y, covered: name + (top.innerText ? ' "' + top.innerText.trim().slice(0, 40) + '"' : "") };
}`;
const SELECT = `function (values) {
  if (this.tagName !== "SELECT") return { notSelect: true };
  const opts = [...this.options];
  const hits = opts.filter((o) => values.some((v) => v === o.value || v === o.label || v === o.textContent.trim()));
  if (!hits.length) return { missing: opts.map((o) => o.label).slice(0, 40) };
  for (const o of opts) o.selected = this.multiple ? hits.includes(o) : o === hits[0];
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { picked: (this.multiple ? hits : hits.slice(0, 1)).map((o) => o.label) };
}`;
// A dot where the agent clicked, so you can see what it's doing in the pane. Gone before the next screenshot.
const RIPPLE = (x, y) => `(() => { const d = document.createElement("div");
  d.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgb(232 84 47/.45);border:2px solid #e8542f;transition:transform .5s,opacity .5s;left:${x}px;top:${y}px";
  document.documentElement.appendChild(d); requestAnimationFrame(() => { d.style.transform = "scale(1.8)"; d.style.opacity = "0"; }); setTimeout(() => d.remove(), 600); })()`;

const q = (value) => JSON.stringify(value);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createPaneInput(/** @type {{ cdp: any, wait?: (ms: number) => Promise<unknown>, now?: () => number }} */ { cdp, wait = sleep, now = Date.now }) {
  async function evaluate(wc, expression) {
    const { result, exceptionDetails } = await cdp.send(wc, "Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || "The page script failed.");
    return result.value;
  }

  // An element by ref or selector, as a remote object the page functions run on. A selector that matches
  // nothing is an error here: the agent asked for something that isn't there.
  async function element(wc, target) {
    const el = await resolveElement(cdp, wc, target);
    if (!el) throw new Error(`No element matches ${target.selector}`);
    return el;
  }

  const call = (wc, el, fn, args = []) => callOn(cdp, wc, el, fn, args);

  async function point(wc, target) {
    const el = await element(wc, target);
    const p = await call(wc, el, POINT);
    if (p.hidden) throw new Error(`${el.label} has no size on the page (hidden?); try its label, or snapshot for what's visible.`);
    if (p.covered) throw new Error(`${p.covered} is on top of ${el.label}; close or click that first.`);
    return { ...p, label: el.label };
  }

  const mouse = (wc, type, x, y, extra = {}) => cdp.send(wc, "Input.dispatchMouseEvent", { type, x, y, ...extra });

  async function click(wc, target, { double = false } = {}) {
    const { x, y, label } = await point(wc, target);
    await mouse(wc, "mouseMoved", x, y);
    for (let n = 1; n <= (double ? 2 : 1); n++) {
      await mouse(wc, "mousePressed", x, y, { button: "left", clickCount: n });
      await mouse(wc, "mouseReleased", x, y, { button: "left", clickCount: n });
    }
    evaluate(wc, RIPPLE(Math.round(x), Math.round(y))).catch(() => {});
    return { clicked: label };
  }

  async function hover(wc, target) {
    const { x, y, label } = await point(wc, target);
    await mouse(wc, "mouseMoved", x, y);
    return { hovered: label };
  }

  async function press(wc, keys, target) {
    const events = keyEvents(keys);
    if (target?.ref || target?.selector) await call(wc, await element(wc, target), "function () { this.focus(); return {}; }");
    for (const e of events) await cdp.send(wc, "Input.dispatchKeyEvent", e);
    return { pressed: String(keys) };
  }

  // Replaces the field's contents, as if typed: the page's own input handlers run. submit presses Enter after.
  async function type(wc, target, text, { submit = false } = {}) {
    const el = await element(wc, target);
    const r = await call(wc, el, FOCUS);
    if (r.notField) throw new Error(`${el.label} isn't a text field.`);
    const value = String(text ?? "");
    if (value) await cdp.send(wc, "Input.insertText", { text: value });
    else await press(wc, "Backspace");
    if (submit) await press(wc, "Enter");
    return { typed: el.label };
  }

  async function select(wc, target, values) {
    const el = await element(wc, target);
    const wanted = (Array.isArray(values) ? values : [values]).map(String);
    const r = await call(wc, el, SELECT, [wanted]);
    if (r.notSelect) throw new Error(`${el.label} isn't a <select>; click it and pick the option instead.`);
    if (r.missing) throw new Error(`No option matches ${wanted.join(", ")}. The options are: ${r.missing.join(", ")}`);
    return { picked: r.picked };
  }

  // With a target and no direction, brings it into view. Otherwise wheels the page (or the box under the
  // target) by amount CSS pixels, so scroll containers move the way they would under a trackpad.
  async function scroll(wc, /** @type {{ ref?: string, selector?: string, direction?: string, amount?: number }} */ { ref, selector, direction, amount = 600 }) {
    const target = { ref, selector };
    if ((ref || selector) && !direction) {
      const el = await element(wc, target);
      await call(wc, el, `function () { this.scrollIntoView({ block: "center", behavior: "instant" }); return {}; }`);
      return { scrolled: el.label };
    }
    const dir = String(direction || "down");
    if (!["up", "down", "left", "right"].includes(dir)) throw new Error("direction is up, down, left or right.");
    const at = ref || selector ? await point(wc, target) : await evaluate(wc, "({ x: innerWidth / 2, y: innerHeight / 2 })");
    const d = Math.max(1, Math.min(10_000, Number(amount) || 600));
    const delta = { deltaX: dir === "left" ? -d : dir === "right" ? d : 0, deltaY: dir === "up" ? -d : dir === "down" ? d : 0 };
    await mouse(wc, "mouseWheel", at.x, at.y, delta);
    await wait(POLL_MS);
    return evaluate(wc, "({ scrollY: Math.round(scrollY), height: document.documentElement.scrollHeight, viewport: innerHeight })");
  }

  // Polls until the text shows up (or goes, with gone) or the selector has a visible match.
  async function waitFor(wc, /** @type {{ text?: string, gone?: string, selector?: string, timeout?: number }} */ { text, gone, selector, timeout = WAIT_DEFAULT_MS }) {
    let check;
    if (text) check = `Boolean(document.body && document.body.innerText.includes(${q(String(text))}))`;
    else if (gone) check = `!(document.body && document.body.innerText.includes(${q(String(gone))}))`;
    else if (selector) check = `(() => { const el = document.querySelector(${q(String(selector))}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; })()`;
    else throw new Error("Give text to wait for, gone (text to wait to disappear), or a selector.");
    const limit = Math.max(0, Math.min(WAIT_MAX_MS, Number(timeout) || WAIT_DEFAULT_MS));
    const start = now();
    for (;;) {
      if (!wc.isLoading() && (await evaluate(wc, check).catch(() => false))) return { waitedMs: now() - start };
      if (now() - start >= limit) throw new Error(`Waited ${Number((limit / 1000).toFixed(1))}s and ${text ? `"${text}" never showed up` : gone ? `"${gone}" is still there` : `${selector} never appeared`}.`);
      await wait(POLL_MS);
    }
  }

  // "phone", "tablet", "desktop" (back to the pane's own size), or a width and height in CSS pixels.
  async function viewport(wc, /** @type {{ size?: string, width?: number, height?: number }} */ { size, width, height }) {
    if (size === "desktop" || size === "reset") {
      await cdp.send(wc, "Emulation.clearDeviceMetricsOverride");
      await cdp.send(wc, "Emulation.setTouchEmulationEnabled", { enabled: false });
    } else {
      const preset = VIEWPORTS[size];
      if (!preset && !(width > 0 && height > 0)) throw new Error('size is "phone", "tablet" or "desktop", or give width and height.');
      const metrics = preset ?? { width: Math.round(width), height: Math.round(height), deviceScaleFactor: 0, mobile: false };
      await cdp.send(wc, "Emulation.setDeviceMetricsOverride", metrics);
      await cdp.send(wc, "Emulation.setTouchEmulationEnabled", { enabled: metrics.mobile, ...(metrics.mobile ? { maxTouchPoints: 5 } : {}) });
    }
    // The override lands a frame or two later.
    await wait(POLL_MS);
    return evaluate(wc, "({ width: innerWidth, height: innerHeight })");
  }

  async function snapshot(wc) {
    const { nodes } = await cdp.send(wc, "Accessibility.getFullAXTree");
    return formatAxTree(nodes ?? []);
  }

  return { click, hover, press, type, select, scroll, waitFor, viewport, snapshot };
}

// The control-server routes for the above. page(body) gives { wc, key } for the card's page (active when no key);
// redact(key, text) swaps any vault value typed into that page for ‹NAME› (electron/pane-secrets.cjs).
function agentRoutes({ input, cdp, page, redact }) {
  const target = (b) => ({ ref: b.ref, selector: b.selector });
  const run = (fn) => async (b) => {
    const { wc, key } = page(b);
    try {
      return await fn(wc, b, key);
    } finally {
      cdp.send(wc, "Runtime.releaseObjectGroup", { objectGroup: GROUP }).catch(() => {});
    }
  };
  return {
    "POST /browser/click": run((wc, b) => input.click(wc, target(b), { double: b.double === true })),
    "POST /browser/hover": run((wc, b) => input.hover(wc, target(b))),
    "POST /browser/type": run((wc, b) => input.type(wc, target(b), b.text, { submit: b.submit === true })),
    "POST /browser/press": run((wc, b) => input.press(wc, b.keys, target(b))),
    "POST /browser/select": run((wc, b) => input.select(wc, target(b), b.values)),
    "POST /browser/scroll": run((wc, b) => input.scroll(wc, b)),
    "POST /browser/wait": run((wc, b) => input.waitFor(wc, b)),
    "POST /browser/viewport": run((wc, b) => input.viewport(wc, b)),
    "POST /browser/snapshot": run(async (wc, _b, key) => {
      const { text, dropped } = await input.snapshot(wc);
      return { url: wc.getURL(), title: redact(key, wc.getTitle()), text: redact(key, text), dropped };
    }),
    "POST /browser/console": run((wc, b, key) => ({ entries: cdp.consoleLogs(wc, b.level).map((e) => ({ ...e, text: redact(key, e.text) })) })),
    "POST /browser/network": run((wc, _b, key) => ({ entries: cdp.networkErrors(wc).map((e) => ({ ...e, url: redact(key, e.url) })) })),
  };
}

module.exports = { createPaneInput, agentRoutes, VIEWPORTS, POINT };
