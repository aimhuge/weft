"use client";

// The open card's host (lib/project-host.ts), with what the card's workspace reads from it: the thread items the show
// rail projects, and the page the pane shows. On this Mac both are the board's own (the thread it loaded, the native
// pane's url). On a worker the thread view pages itself in, so the rail reads what it drew (lib/worker-shown.ts), and
// the pane is the card's last page, or the one the rail reopened, until the card opens another.
import { useEffect, useMemo, useState } from "react";
import { hostOf, type ProjectHost } from "./project-host";
import { useSessionLine } from "./session-lines";
import { parseWorkerProject } from "./worker-project";
import type { Card, ThreadItem } from "./types";
import { workerPagePick } from "./worker-page-pick";
import { clearShown, useWorkerShown } from "./worker-shown";

export interface OpenHost {
  host: ProjectHost;
  items: ThreadItem[];
  page: {
    url: string;
    // Puts the pane back on a page, from the rail; left out on this Mac, where the native pane does it.
    open?: (url: string) => void;
    // The pictures the rail shows for pages; left out on this Mac, where it captures its own (lib/page-shots.ts).
    shots?: Record<string, string>;
  };
}

// A page the rail picked, held while the card stays on the page it had then.
type Picked = { card: string; page: string | undefined; url: string };

// What a worker card's page picture can be: its last pane capture, when it's a picture the board can load.
function cardShots(page: string | undefined, thumb: string | undefined): Record<string, string> {
  return page && thumb && /^https?:/.test(thumb) ? { [page]: thumb } : {};
}

export function useProjectHost(card: Card, local: { items: ThreadItem[]; pageUrl: string }): OpenHost {
  const host = hostOf(card);
  // An open worker card holds its worker's session line, so its acts and thread take the direct route.
  useSessionLine(parseWorkerProject(card.cwd)?.workerId);
  const shown = useWorkerShown();
  const [picked, setPicked] = useState<Picked | null>(null);
  // The same pictures while the page and its capture stay put, so the rail doesn't redraw on every worker poll.
  const shots = useMemo(() => cardShots(card.page, card.thumb), [card.page, card.thumb]);
  // The next card starts with an empty rail rather than the last one's thread.
  useEffect(() => clearShown, [card.id]);
  if (host.can("pane")) return { host, items: local.items, page: { url: local.pageUrl } };
  const url = picked && picked.card === card.id && picked.page === card.page ? picked.url : (card.page ?? "");
  // A path or localhost URL only the worker has goes to the blob the card opened it as, or opens nothing
  // (lib/worker-page-pick.ts), rather than a pane that says the page isn't here.
  const open = (next: string) => {
    const page = workerPagePick(next, shown);
    if (page) setPicked({ card: card.id, page: card.page, url: page });
  };
  return { host, items: shown, page: { url, open, shots } };
}
