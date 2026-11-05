// The worker's browser (docs/architecture/worker-browser.md): one headless Chromium, started on a card's first browser
// tool and stopped once no card has used it for a while, with a browser context per card, so cards share no cookies,
// storage or pages. Each card has one page. Every file: request any page or frame makes goes past the guard
// (lib/worker-browser-guard.ts) before it loads, downloads are refused, and a popup is closed as it opens.
import { mayLoad } from "./worker-browser-guard";
import { browserPage, type BrowserPage } from "./worker-browser-page";
import { launchChromium, quietly, type Cdp, type CdpEvent } from "./worker-chromium";

// A card's context closes after this long with no tool call and no live view; the browser with the last one.
export const IDLE_MS = 10 * 60_000;
export const VIEW = { width: 1280, height: 800 };

type Entry = { page: BrowserPage; contextId: string; cdp: Cdp; timer?: ReturnType<typeof setTimeout>; hold?: () => boolean };

let launch: () => Cdp = launchChromium;
let browser: Promise<Cdp> | null = null;
const entries = new Map<string, Entry>();
const opening = new Map<string, Promise<BrowserPage>>();

// Tests hand in a fake browser, or a real one with a different binary.
export function setBrowserLauncher(fn: () => Cdp) {
  launch = fn;
}

// The rules that hold for every request: a file: request goes past the guard; anything else isn't paused.
function guard(cdp: Cdp, e: CdpEvent) {
  if (e.method !== "Fetch.requestPaused") return;
  const { requestId, request } = e.params as { requestId: string; request: { url: string } };
  const ok = mayLoad(request.url);
  quietly(cdp.send(ok ? "Fetch.continueRequest" : "Fetch.failRequest", ok ? { requestId } : { requestId, errorReason: "AccessDenied" }, e.sessionId));
}

// A frame in another process (an out-of-process iframe) starts paused, so it gets the same guard before it loads.
function child(cdp: Cdp, e: CdpEvent) {
  if (e.method !== "Target.attachedToTarget" || !e.sessionId) return;
  const { sessionId, targetInfo } = e.params as { sessionId: string; targetInfo: { type: string; targetId: string } };
  if (targetInfo.type === "page") {
    quietly(cdp.send("Target.closeTarget", { targetId: targetInfo.targetId }));
    return;
  }
  // A frame runs only once its guard is in: one whose guard failed stays paused (blank) rather than load unguarded.
  // A worker can't take auto-attach and can't fetch a file: anyway, so it runs either way.
  const run = () => quietly(cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId));
  const guarded = guardSession(cdp, sessionId);
  if (targetInfo.type === "iframe") guarded.then(run, () => {});
  else quietly(guarded.finally(run));
}

// Popups: one page per card, so a window.open or a target=_blank link is closed before it can load anything.
function popup(cdp: Cdp, e: CdpEvent) {
  if (e.method !== "Target.targetCreated") return;
  const info = e.params.targetInfo as { type: string; targetId: string; browserContextId?: string };
  const ours = [...entries.values()].some((x) => x.contextId === info.browserContextId);
  const known = [...entries.values()].some((x) => x.page.targetId === info.targetId);
  if (info.type === "page" && ours && !known) quietly(cdp.send("Target.closeTarget", { targetId: info.targetId }));
}

async function guardSession(cdp: Cdp, sessionId: string) {
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "file://*" }] }, sessionId);
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
}

async function start(): Promise<Cdp> {
  const cdp = launch();
  cdp.on((e) => {
    guard(cdp, e);
    child(cdp, e);
    popup(cdp, e);
  });
  cdp.onClose(() => {
    browser = null;
    entries.forEach((x) => clearTimeout(x.timer));
    entries.clear();
  });
  quietly(cdp.send("Browser.setDownloadBehavior", { behavior: "deny" }));
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  return cdp;
}

function browserNow(): Promise<Cdp> {
  browser ??= start().catch((err: unknown) => {
    browser = null;
    throw err;
  });
  return browser;
}

async function openPage(key: string): Promise<BrowserPage> {
  const cdp = await browserNow();
  const { browserContextId } = (await cdp.send("Target.createBrowserContext", { disposeOnDetach: true })) as { browserContextId: string };
  // The browser-wide setting covers only the default context, so each card's context refuses downloads itself.
  await cdp.send("Browser.setDownloadBehavior", { behavior: "deny", browserContextId });
  const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank", browserContextId, ...VIEW })) as { targetId: string };
  const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
  const page = browserPage(cdp, key, targetId, sessionId);
  await guardSession(cdp, sessionId);
  await page.send("Page.enable");
  entries.set(key, { page, contextId: browserContextId, cdp });
  return page;
}

// The card's page, opened (and the browser started) the first time.
export async function pageFor(key: string): Promise<BrowserPage> {
  const had = entries.get(key);
  if (had && !had.page.wc.isDestroyed()) return touch(key), had.page;
  let pending = opening.get(key);
  if (!pending) {
    pending = openPage(key).finally(() => opening.delete(key));
    opening.set(key, pending);
  }
  const page = await pending;
  touch(key);
  return page;
}

// The card's page if it has one; the tools that read or act on a page need one open_url opened.
export function existingPage(key: string): BrowserPage | null {
  const had = entries.get(key);
  if (!had || had.page.wc.isDestroyed()) return null;
  touch(key);
  return had.page;
}

// hold: while it says true (a live view running), the page isn't idle.
export function holdOpen(key: string, hold: () => boolean) {
  const had = entries.get(key);
  if (had) had.hold = hold;
}

export function touch(key: string) {
  const had = entries.get(key);
  if (!had) return;
  clearTimeout(had.timer);
  had.timer = setTimeout(() => (had.hold?.() ? touch(key) : closePage(key)), IDLE_MS);
  had.timer.unref();
}

export function closePage(key: string) {
  const had = entries.get(key);
  if (!had) return;
  clearTimeout(had.timer);
  entries.delete(key);
  quietly(had.cdp.send("Target.disposeBrowserContext", { browserContextId: had.contextId }));
  if (!entries.size) stopBrowser();
}

export function stopBrowser() {
  const was = browser;
  browser = null;
  entries.forEach((x) => clearTimeout(x.timer));
  entries.clear();
  if (was) quietly(was.then((cdp) => cdp.close()));
}

export const browserRunning = () => browser !== null;
