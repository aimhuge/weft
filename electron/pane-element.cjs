// Finding one element on a pane page, the one way: a ref from the accessibility snapshot (electron/pane-ax.cjs)
// or a CSS selector. The agent tools' input (electron/pane-input.cjs) and the vault's fill
// (electron/pane-actions.cjs) both ask for "the field on this page", and they used to look for it two
// different ways, so the same selector was a miss in one and an error in the other (docs/architecture/agent-browser.md).

const { parseRef } = require("./pane-ax.cjs");
const { findExpression, invalidMessage } = require("./pane-selector.cjs");

// Every remote object an operation makes is in this group, let go of when the route answers.
const GROUP = "weft-agent";

const q = (value) => JSON.stringify(value);

/**
 * The element a ref or a selector names, as a remote object the page functions run on.
 *
 * A ref is a number the snapshot gave the node; a selector is a CSS selector, or one with Playwright's
 * text pseudo-classes (:text-is("Settings…"), :has-text("Save")), which the page finds by reading text
 * (electron/pane-selector.cjs). Returns null when a selector matches nothing on the page: the caller
 * decides whether that is a miss to report or an error to throw. A ref that isn't one, a selector that
 * isn't valid CSS, and a ref whose node is gone are errors either way.
 */
async function resolveElement(cdp, wc, { ref, selector } = {}) {
  if (ref) {
    const backendNodeId = parseRef(ref);
    if (!backendNodeId) throw new Error(`${ref} isn't a ref; refs look like e123 and come from snapshot.`);
    try {
      const { object } = await cdp.send(wc, "DOM.resolveNode", { backendNodeId, objectGroup: GROUP });
      return { objectId: object.objectId, label: ref };
    } catch {
      throw new Error(`${ref} isn't on the page any more; take a new snapshot.`);
    }
  }
  const sel = String(selector ?? "").trim();
  if (!sel) throw new Error("Give a ref from snapshot, or a CSS selector.");
  const { result, exceptionDetails } = await cdp.send(wc, "Runtime.evaluate", { expression: findExpression(sel), objectGroup: GROUP });
  if (exceptionDetails) throw new Error(invalidMessage(sel));
  if (!result.objectId) return null;
  return { objectId: result.objectId, label: sel };
}

// Focuses the element and selects what is in it, so what is typed replaces it.
const FOCUS = `function () {
  const field = this.matches("input, textarea, select") || this.isContentEditable;
  if (!field) return { notField: true };
  this.focus();
  if (typeof this.select === "function") this.select();
  else document.execCommand("selectAll");
  return {};
}`;

/** Runs a page function on the element and answers what it returned. */
async function callOn(cdp, wc, el, fn, args = []) {
  const { result, exceptionDetails } = await cdp.send(wc, "Runtime.callFunctionOn", {
    objectId: el.objectId,
    functionDeclaration: fn,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || `Couldn't act on ${el.label}.`);
  return result.value ?? {};
}

module.exports = { resolveElement, callOn, FOCUS, GROUP };
