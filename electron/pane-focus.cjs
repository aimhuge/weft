// mcp__browser__focus: brings a section of the pane's page into view and flashes it, so your eye lands on what's
// new instead of rereading the whole page (a Researcher's growing research page, a plan with one step ticked, a
// diagram that changed). reload: true reloads the page first, for a thread that just edited the page's file, and
// puts the scroll back where you were before gliding from there to the section: you see the page move from what you'd
// read to what's new, never a jump to the top. CDP only, so a Weft Worker's headless browser runs it too
// (lib/worker-browser-routes.ts). docs/architecture/agent-browser.md#focus.

const { resolveElement, callOn } = require("./pane-element.cjs");

const RELOAD_MS = 15_000;
const POLL_MS = 100;
const LABEL_MAX = 60;

// Runs on the element: glides it near the top of the view (under any sticky header) and draws a flash over it that
// pulses and fades on its own. The flash is Weft's, not the page's, so it works on any page with no CSS of its own.
const GLIDE = `function (label) {
  const r = this.getBoundingClientRect();
  if (!r.width && !r.height) return { hidden: true };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = Math.max(0, r.top + scrollY - Math.min(80, innerHeight * 0.12));
  scrollTo({ top, behavior: still ? "instant" : "smooth" });
  document.querySelectorAll("[data-weft-focus]").forEach((n) => n.remove());
  const f = document.createElement("div");
  f.setAttribute("data-weft-focus", "");
  f.style.cssText = "position:absolute;z-index:2147483646;pointer-events:none;border-radius:10px;border:3px solid #f2b84b;"
    + "box-shadow:0 0 0 6px rgb(242 184 75/.25);transition:opacity .8s ease-out;"
    + "left:" + (r.left + scrollX - 6) + "px;top:" + (r.top + scrollY - 6) + "px;width:" + (r.width + 12) + "px;height:" + (r.height + 12) + "px";
  if (label) {
    const t = document.createElement("span");
    t.textContent = label;
    t.style.cssText = "position:absolute;left:8px;top:-13px;padding:1px 8px;border-radius:99px;background:#f2b84b;color:#111;"
      + "font:600 12px/20px system-ui,sans-serif;white-space:nowrap";
    f.appendChild(t);
  }
  document.documentElement.appendChild(f);
  if (!still) f.animate([{ boxShadow: "0 0 0 0 rgb(242 184 75/.6)" }, { boxShadow: "0 0 0 14px rgb(242 184 75/0)" }], { duration: 900, iterations: 3 });
  setTimeout(() => { f.style.opacity = "0"; }, 3200);
  setTimeout(() => f.remove(), 4100);
  return { text: (this.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 80) };
}`;

const q = (value) => JSON.stringify(value);

function createPaneFocus(/** @type {{ cdp: any, wait: (ms: number) => Promise<unknown>, now: () => number }} */ { cdp, wait, now }) {
  async function evaluate(wc, expression) {
    const { result, exceptionDetails } = await cdp.send(wc, "Runtime.evaluate", { expression, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || "The page script failed.");
    return result.value;
  }

  // Reloads and waits for the new document (a mark left on the old window is gone, and it has loaded), then
  // scrolls back to where the reader was.
  async function reloadInPlace(wc) {
    const y = Number(await evaluate(wc, "Math.round(scrollY)")) || 0;
    const mark = `f${now()}`;
    await evaluate(wc, `window.__weftFocus = ${q(mark)}`);
    await cdp.send(wc, "Page.reload", { ignoreCache: true });
    const start = now();
    const fresh = `document.readyState === "complete" && window.__weftFocus !== ${q(mark)}`;
    while (!(await evaluate(wc, fresh).catch(() => false))) {
      if (now() - start >= RELOAD_MS) throw new Error(`The page didn't finish reloading in ${RELOAD_MS / 1000}s.`);
      await wait(POLL_MS);
    }
    await evaluate(wc, `scrollTo({ top: ${y}, behavior: "instant" })`);
  }

  async function focus(wc, /** @type {{ ref?: string, selector?: string, reload?: boolean, label?: string }} */ { ref, selector, reload, label }) {
    if (!ref && !selector) throw new Error("Give the selector (or ref) of the section to bring into view, like #r3.");
    if (reload && ref && !selector) throw new Error("A reload makes a new page, so refs from before it are gone; give a CSS selector like #r3.");
    if (reload) await reloadInPlace(wc);
    const el = await resolveElement(cdp, wc, { ref: reload ? undefined : ref, selector });
    if (!el) throw new Error(`No element matches ${selector ?? ref}${reload ? " after the reload" : ""}.`);
    const r = await callOn(cdp, wc, el, GLIDE, [label ? String(label).slice(0, LABEL_MAX) : ""]);
    if (r.hidden) throw new Error(`${el.label} has no size on the page (hidden?).`);
    return { focused: el.label, text: r.text, reloaded: Boolean(reload) };
  }

  return { focus };
}

module.exports = { createPaneFocus, GLIDE, RELOAD_MS };
