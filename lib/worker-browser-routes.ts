// The browser shell's routes on a Weft Worker (docs/architecture/worker-browser.md): the same /browser/* routes and
// answers Electron main gives a desktop card (electron/browser-pane.cjs, electron/pane-input.cjs), served from the
// worker's own headless Chromium (lib/worker-browser.ts), so lib/browser-tools.ts and lib/browser-act-tools.ts don't
// change. The acting routes are pane-input's own, run on the page's CDP session through a webContents-shaped adapter.
import { createPaneCdp } from "../electron/pane-cdp.cjs";
import { agentRoutes, createPaneInput } from "../electron/pane-input.cjs";
import { highlightExpression } from "../electron/pane-selector.cjs";
import { existingPage, pageFor } from "./worker-browser";
import { mayLoad, navigable, refusal } from "./worker-browser-guard";
import type { BrowserPage } from "./worker-browser-page";
import { quietly } from "./worker-chromium";
import { paneMovedOn, showLive } from "./worker-browser-screen";

type Body = Record<string, unknown>;
type Route = (body: Body) => Promise<Record<string, unknown>> | Record<string, unknown>;

const LOAD_MS = 15_000;
const MAX_TEXT = 30_000;
// Routes that change what's on the page: the card's pane follows the browser live once one runs.
const ACTS = new Set(["click", "hover", "type", "press", "select", "scroll", "viewport"]);

export const NO_PAGE = "The worker's browser has no page open yet. Use open_url first.";
export const FILL_REFUSAL = "fill_field types vault values, so it runs only in the desktop app's pane; a card on a Weft Worker can't use it.";

const cdp = createPaneCdp();
const input = createPaneInput({ cdp });
const keyOf = (b: Body) => (typeof b.key === "string" ? b.key : "");
export const NO_CARD = "The worker's browser opens a page per card, and this thread has no card yet.";
// The card a page belongs to: never "", which every card-less caller would share.
function cardKey(key: string) {
  if (!key) throw new Error(NO_CARD);
  return key;
}

function requirePage(b: Body): BrowserPage {
  const page = existingPage(cardKey(keyOf(b)));
  if (!page) throw new Error(NO_PAGE);
  return page;
}

// Resolves on the main frame's load, or after LOAD_MS: a page that never finishes loading is still a page.
function loaded(page: BrowserPage, ms = LOAD_MS) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    const off = page.on((method) => method === "Page.loadEventFired" && done());
    function done() {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
}

export async function navigate(key: string, raw: string, loadMs = LOAD_MS) {
  const url = navigable(raw);
  if (!mayLoad(url)) throw new Error(refusal(url));
  const page = await pageFor(cardKey(key));
  // From the first load, so its console and failed requests are caught (electron/pane-cdp.cjs).
  cdp.attach(page.wc);
  const load = loaded(page, loadMs);
  const r = (await page.send("Page.navigate", { url })) as { errorText?: string };
  if (r.errorText === "net::ERR_ACCESS_DENIED") throw new Error(refusal(url));
  if (r.errorText && r.errorText !== "net::ERR_ABORTED") throw new Error(`Couldn't open ${url}: ${r.errorText}`);
  if (!r.errorText) await load;
  await page.refresh();
  return { url: page.wc.getURL(), title: page.wc.getTitle() };
}

async function pageText(b: Body) {
  const page = requirePage(b);
  await page.refresh();
  const r = (await page.send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true })) as { result?: { value?: string } };
  return { url: page.wc.getURL(), title: page.wc.getTitle(), text: (r.result?.value ?? "").slice(0, MAX_TEXT) };
}

// As electron/pane-capture.cjs: highlight boxes the element for the shot and takes the box away after.
async function screenshot(b: Body) {
  const page = requirePage(b);
  const highlight = typeof b.highlight === "string" && b.highlight ? b.highlight : undefined;
  let found = false;
  if (highlight) {
    const r = (await page.send("Runtime.evaluate", { expression: highlightExpression(highlight), returnByValue: true }).catch(() => ({}))) as { result?: { value?: unknown } };
    found = r.result?.value === true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  try {
    const { data } = (await page.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    return { png: data, ...(highlight ? { found } : {}) };
  } finally {
    if (found) quietly(page.send("Runtime.evaluate", { expression: `document.getElementById("__weft_highlight")?.remove()` }));
  }
}

const agent = agentRoutes({
  input,
  cdp,
  page: (b: Body) => ({ wc: requirePage(b).wc, key: keyOf(b) }),
  redact: (_key: string, text: string) => text,
}) as Record<string, Route>;

export const workerBrowserRoutes: Record<string, Route> = {
  "/browser/open": async (b) => {
    const page = await navigate(keyOf(b), typeof b.url === "string" ? b.url : "");
    // A page the card wrote goes up to the pane as itself (lib/worker-pane.ts); anything else shows live.
    if (page.url.startsWith("file:")) paneMovedOn(keyOf(b));
    else await showLive(keyOf(b));
    return page;
  },
  "/browser/text": pageText,
  "/browser/screenshot": screenshot,
  "/browser/url": (b) => ({ url: existingPage(keyOf(b))?.wc.getURL() ?? "" }),
  // A worker's card has no thumbnail (lib/card-pictures.ts reads none from a worker).
  "/browser/thumb": () => ({ jpg: null }),
  "/secrets/fill": () => {
    throw new Error(FILL_REFUSAL);
  },
  ...Object.fromEntries(
    Object.entries(agent).map(([route, run]) => {
      const name = route.replace("POST /browser/", "");
      const path = `/browser/${name}`;
      return [
        path,
        async (b: Body) => {
          const page = requirePage(b);
          await page.refresh();
          const result = await run(b);
          // The act already happened: a live view that can't start mustn't make it look failed (and get retried).
          if (ACTS.has(name)) await showLive(keyOf(b)).catch(() => {});
          return result;
        },
      ];
    }),
  ),
};

// lib/browser-shell.ts on a worker: the route, or the same "needs the desktop" answer for one that isn't here.
export async function workerShell(route: string, body: Body = {}) {
  const run = workerBrowserRoutes[route];
  if (!run) throw new Error(`${route} needs the desktop app; this card runs on a Weft Worker.`);
  return run(body);
}
