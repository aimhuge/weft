// mcp__browser__open_url on a Weft Worker, where there's no Electron and so no pane to drive
// (docs/architecture/weft-worker.md#pages-from-a-worker). A page a card wrote goes up as a blob before the tool answers,
// so a failed upload is an error the agent reads rather than a page nobody sees, and the card's `page` then carries it
// to both boards: lib/worker-publish.ts swaps the path for its ref in the row and in the thread's open_url item.
import fs from "node:fs";
import { resolvePage } from "./blob-paths";
import { notePage } from "./card-page";
import type { BlobRef } from "./cloud-sync-types";
import { paneFromUrl } from "./share-types";

export type PageUpload = (local: string) => Promise<BlobRef | null>;

let upload: PageUpload | null = null;

// scripts/weft-worker.ts: the blob store's uploadPage, bound to this worker's org.
export function setPageUpload(fn: PageUpload | null) {
  upload = fn;
}

export const onWorker = (env: NodeJS.ProcessEnv = process.env) => env.WEFT_WORKER === "1";

const titleOf = (file: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(fs.readFileSync(file, "utf8").slice(0, 4096))?.[1]?.trim() ?? "";

const noServers = "A dev server on a worker can't reach the boards yet. Write what you want to show as an HTML page and open that.";
const refused = (url: string) => `Can't show ${url}: a worker only sends web files (HTML, images, video, fonts) from its show folder or the project's checkout, and never from a dot folder. Move the page to one of those, as an absolute path.`;

export async function openOnWorker(cardId: string | undefined, url: string): Promise<string> {
  const pane = paneFromUrl(url);
  if (pane?.kind === "site") {
    notePage(cardId, pane.url);
    return `Opened ${pane.url}`;
  }
  if (pane?.kind === "local" && !/^(file:|\/)/i.test(pane.url)) throw new Error(noServers);
  const found = resolvePage(url.trim());
  if (!found) throw new Error(refused(url));
  if (!upload) throw new Error("This worker can't upload pages yet. Update it with weft-worker update.");
  const ref = await upload(found.local);
  if (!ref) throw new Error(refused(url));
  notePage(cardId, url.trim());
  return `Opened ${url.trim()} — ${titleOf(found.local) || "page"}. It's in the pane on the user's board.`;
}
