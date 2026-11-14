import type { MiniApp } from "./mini-apps";

// Edit app (components/AppEditButton.tsx): a saved app that's a local page opens the New thread dialog on the page's
// own folder, with a draft that names the app and its files, so the user only types what to change. An app on the web
// or a dev server has no files here to edit, so it gets no button (null).

export interface AppEditTarget {
  folder: string;
  draft: string;
}

export function appEditTarget(app: Pick<MiniApp, "name" | "url">): AppEditTarget | null {
  let url: URL;
  try {
    url = new URL(app.url);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  const file = decodeURIComponent(url.pathname);
  const folder = file.replace(/\/[^/]*$/, "") || "/";
  const draft =
    `Edit the mini app "${app.name}". Its page is ${file}` +
    ` (with its weft-app.json manifest beside it, if it reads data). Keep it working in the browser pane, then show it there.\n\n` +
    `What to change: `;
  return { folder, draft };
}
