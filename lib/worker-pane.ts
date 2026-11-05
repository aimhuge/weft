// mcp__browser__open_url on a Weft Worker, where there's no Electron and so no pane to drive
// (docs/architecture/weft-worker.md#pages-from-a-worker). A page a card wrote goes up as a blob before the tool answers,
// so a failed upload is an error the agent reads rather than a page nobody sees, and the card's `page` then carries it
// to both boards: lib/worker-publish.ts swaps the path for its ref in the row and in the thread's open_url item.
import fs from "node:fs";
import { resolvePage } from "./blob-paths";
import { notePage } from "./card-page";
import type { BlobRef } from "./cloud-sync-types";
import { fileCallInside } from "./folder-guard";
import { paneFromUrl } from "./share-types";
import { SHOW_DIR } from "./show-dir";
import { tunnelFor } from "./tunnels";
import type { PermissionMode } from "./types-card";

// The card it opened for, so the page goes up sealed when that card's rows do (lib/worker-sealing.ts).
export type PageUpload = (local: string, cardId?: string) => Promise<BlobRef | null>;

let upload: PageUpload | null = null;

// scripts/weft-worker.ts: the blob store's uploadPage, bound to this worker's org.
export function setPageUpload(fn: PageUpload | null) {
  upload = fn;
}

export const onWorker = (env: NodeJS.ProcessEnv = process.env) => env.WEFT_WORKER === "1";

// A worker's own pane page doesn't ask, in any mode but the one that asks on purpose. The folder above settles
// acceptEdits, but Auto can still reach canUseTool on a worker, and the page would wait on a box nobody is at. Default
// is the mode you picked to be asked in. This sits after the hooks, so the secret guard's refusals still win.
export function ownPageCall(toolName: string, input: Record<string, unknown>, spec: { cwd: string; permissionMode: PermissionMode }, env: NodeJS.ProcessEnv = process.env) {
  return onWorker(env) && spec.permissionMode !== "default" && fileCallInside(toolName, input, spec.cwd, SHOW_DIR);
}

const titleOf = (file: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(fs.readFileSync(file, "utf8").slice(0, 4096))?.[1]?.trim() ?? "";

const noServers = "A dev server on a worker can't reach the boards by itself, and this worker's browser couldn't open it. Give it a private address with mcp__webhooks__tunnel (the user approves on their Mac), then open this URL again; or write what you want to show as an HTML page and open that.";
const refused = (url: string) => `Can't show ${url}: a worker only sends web files (HTML, images, video, fonts) from its show folder or the project's checkout, and never from a dot folder. Move the page to one of those, as an absolute path.`;

export type BrowseFn = (cardId: string, url: string) => Promise<{ url: string; title: string }>;
// The worker's own browser (lib/worker-browser-routes.ts), loaded on first use: a desktop never needs it.
const browseOnWorker: BrowseFn = async (cardId, url) => (await import("./worker-browser-routes")).workerShell("/browser/open", { key: cardId, url }) as Promise<{ url: string; title: string }>;

// A public site or this box's own dev server opens in the worker's browser, which streams to the pane live. A site still
// shows as itself when the browser can't start; a dev server can't show any other way.
async function openLive(cardId: string | undefined, url: string, local: boolean, browse: BrowseFn) {
  try {
    const page = await browse(cardId ?? "", url);
    return `Opened ${page.url} — ${page.title || "page"}. It's live in the pane on the user's board, from this worker's browser.`;
  } catch (err) {
    if (local) throw err;
    notePage(cardId, url);
    return `Opened ${url}`;
  }
}

// A localhost URL with a tunnel is traded for its private address, which only the signed-in owner gets through
// (docs/architecture/tunnels.md#on-a-worker); the board shows it as a site, with Open ↗. Without one it opens live in
// the worker's browser; with neither it says how to get a tunnel.
async function openDevServer(cardId: string | undefined, local: string, browse: BrowseFn): Promise<string> {
  const open = tunnelFor(local);
  if (open) {
    const { pathname, search, hash } = new URL(local);
    const address = `${open.address}${pathname === "/" ? "" : pathname}${search}${hash}`;
    notePage(cardId, address);
    return `Opened ${local} at its private address ${address}. It's in the pane on the user's board, for them only.`;
  }
  try {
    return await openLive(cardId, local, true, browse);
  } catch (err) {
    throw new Error(`${noServers} (${err instanceof Error ? err.message : String(err)})`);
  }
}

export async function openOnWorker(cardId: string | undefined, url: string, browse: BrowseFn = browseOnWorker): Promise<string> {
  const pane = paneFromUrl(url);
  if (pane?.kind === "site") return openLive(cardId, pane.url, false, browse);
  if (pane?.kind === "local" && !/^(file:|\/)/i.test(pane.url)) return openDevServer(cardId, pane.url, browse);
  const found = resolvePage(url.trim());
  if (!found) throw new Error(refused(url));
  if (!upload) throw new Error("This worker can't upload pages yet. Update it with weft-worker update.");
  const ref = await upload(found.local, cardId);
  if (!ref) throw new Error(refused(url));
  notePage(cardId, url.trim());
  // The same page in the worker's browser too, so read_page, snapshot and click act on what the pane shows.
  await browse(cardId ?? "", found.local).catch(() => {});
  return `Opened ${url.trim()} — ${titleOf(found.local) || "page"}. It's in the pane on the user's board.`;
}
