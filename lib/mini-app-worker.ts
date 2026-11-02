// Save as app on a page a worker card shows (docs/architecture/mini-apps.md#from-a-worker-card): the page is a blob
// in the workspace's store (lib/worker-pane.ts uploaded it), framed on the board through this Mac's server. An app is a
// page this Mac's pane opens, so the page comes home first, read with the account's own session, into
// ~/.weft/apps/worker-<sha>/index.html: the same place and shape a cloud sync pull brings a saved app to
// (lib/app-cloud.ts pullOne). From there it is an app like any other: the rail opens it, cloud_mini_apps carries it
// to your other Macs, and Share… serves it at weft.zip/a/<id> (lib/app-share.ts), uploading the same bytes, which
// are already in the store under the same sha.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { blobPageSha, cleanAppName, type MiniApp } from "./mini-apps";
import { saveApp } from "./mini-app-store";
import { DATA_DIR } from "./store";

export type PageBytes = { bytes: ArrayBuffer | Uint8Array; type: string };
export type ReadPage = (sha: string) => Promise<PageBytes | null>;

// The page's bytes as the signed-in account reads them; RLS keeps it to your workspace's blobs.
async function readWorkerPage(sha: string): Promise<PageBytes | null> {
  const [{ accountClient }, { requireSession }, { readBlob }] = await Promise.all([import("./account"), import("./worker-board"), import("./blob-read")]);
  const client = accountClient();
  const who = await requireSession(client);
  return readBlob(client, who.org, sha, { r2: null });
}

const titleOf = (html: string) => /<title[^>]*>([^<]*)<\/title>/i.exec(html.slice(0, 8192))?.[1]?.trim();

export async function saveWorkerPageApp(page: unknown, name: unknown, read: ReadPage = readWorkerPage, home = DATA_DIR): Promise<MiniApp> {
  const sha = blobPageSha(page);
  if (!sha) throw new Error("That isn't a page a worker card showed.");
  const got = await read(sha);
  if (!got) throw new Error("That page isn't in your workspace's store anymore.");
  if (!got.type.startsWith("text/html")) throw new Error("Only a web page can be an app: this is a file.");
  const html = new TextDecoder().decode(got.bytes);
  const file = path.join(home, "apps", `worker-${sha.slice(0, 16)}`, "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  return saveApp(pathToFileURL(file).href, cleanAppName(name) ?? cleanAppName(titleOf(html)) ?? "Worker page", `blob:sha256:${sha}`);
}
