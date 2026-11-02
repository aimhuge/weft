// What the worker's browser may load (docs/architecture/worker-browser.md#what-guards-it). The web and this box's own
// dev servers, yes: localhost is the point. A file only when it's a page a card could publish anyway (a web file in the
// show folder or a checkout, no dot folder, links followed: lib/worker-blobs.ts) and the secret guard doesn't know it as
// a secret (lib/secret-guard-files.ts), so a page can't frame or link its way to worker.json, worker.env or the seal key.
// Nothing else: chrome://, view-source:, devtools: and the like.
import { fileURLToPath } from "node:url";
import { isSecretFile } from "./secret-guard-files";
import { SHOW_DIR } from "./show-dir";
import { workerMayUpload } from "./worker-blobs";
import { workerHome, workRoot } from "./worker-config";

const WEB = /^(https?|wss?):$/i;
// Pages a navigation lands on by itself: a blank tab, an error page, a page's own data: or blob: content.
const INERT = /^(about:blank|about:srcdoc|data:|blob:|chrome-error:)/i;

export const fileRoots = (env: NodeJS.ProcessEnv = process.env) => [SHOW_DIR, workRoot(workerHome(env), env)];

// The file a file: URL names, or null for one that doesn't parse.
function fileOf(url: string): string | null {
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

export function mayLoadFile(url: string, roots = fileRoots()): boolean {
  const file = fileOf(url);
  return !!file && !isSecretFile(file) && workerMayUpload(file, roots);
}

// Every request the browser makes, checked: what the Fetch interception asks for each paused file: request.
export function mayLoad(url: string, roots = fileRoots()): boolean {
  if (INERT.test(url)) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (WEB.test(parsed.protocol)) return true;
  return parsed.protocol === "file:" && mayLoadFile(url, roots);
}

// What open_url hands the browser: an absolute path becomes a file: URL; a bare host gets https.
export function navigable(raw: string): string {
  const url = raw.trim();
  if (url.startsWith("/")) return `file://${encodeURI(url)}`;
  if (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url)) return `http://${url}`;
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
}

export function refusal(url: string) {
  return url.startsWith("file:")
    ? `Can't open ${url} in the worker's browser: it opens only web files (HTML, images, CSS, JS) in the show folder or a checkout, never a dot folder or a secret.`
    : `Can't open ${url} in the worker's browser: it opens http, https and allowed files only.`;
}
