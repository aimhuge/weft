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
import type { PermissionMode } from "./types-card";

export type PageUpload = (local: string) => Promise<BlobRef | null>;

let upload: PageUpload | null = null;

// scripts/weft-worker.ts: the blob store's uploadPage, bound to this worker's org.
export function setPageUpload(fn: PageUpload | null) {
  upload = fn;
}

export const onWorker = (env: NodeJS.ProcessEnv = process.env) => env.WEFT_WORKER === "1";

// The folders a session's CLI works in beyond its cwd. A worker adds the show folder, which is all of it and not its
// parent: acceptEdits only writes without asking inside the CLI's working directories, and a page can't wait for
// someone to press Allow on a headless box. A desktop card doesn't need this: it runs in Auto or YOLO, or you're there
// to answer. The CLI drops a directory that isn't there, so it's made first. docs/architecture/weft-worker.md#pages-from-a-worker
export function sessionDirs(readScope: string[] | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!onWorker(env)) return readScope;
  fs.mkdirSync(SHOW_DIR, { recursive: true });
  return [...new Set([...(readScope ?? []), SHOW_DIR])];
}

// A worker's own pane page doesn't ask, in any mode but the one that asks on purpose. The folder above settles
// acceptEdits, but Auto can still reach canUseTool on a worker, and the page would wait on a box nobody is at. Default
// is the mode you picked to be asked in. This sits after the hooks, so the secret guard's refusals still win.
export function ownPageCall(toolName: string, input: Record<string, unknown>, spec: { cwd: string; permissionMode: PermissionMode }, env: NodeJS.ProcessEnv = process.env) {
  return onWorker(env) && spec.permissionMode !== "default" && fileCallInside(toolName, input, spec.cwd, SHOW_DIR);
}

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
