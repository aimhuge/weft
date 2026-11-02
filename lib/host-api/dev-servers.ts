// A card's dev server, from the board's Services drawer (docs/architecture/dev-servers.md#on-a-worker). On a worker the
// board can't reach its localhost, so `dev.open` gives the server a private /t/<id> address: a tunnel, after the owner's
// Touch ID on their Mac (lib/tunnel-worker.ts). On the Mac the same verb opens a Mac tunnel. `dev.stop` ends the run.
import { listDev } from "../devserver-list";
import { stopDev } from "../devserver";
import { openTunnel } from "../tunnels";
import { OK, requireCard, settle, type Ok } from "./types";

export async function devOpenVerb({ id }: { id: string }): Promise<{ address: string }> {
  const card = requireCard(id);
  const entry = (await listDev()).find((e) => e.cardId === id && e.url);
  if (!entry?.url) throw new Error("That card has no dev server with a url to open.");
  const tunnel = await openTunnel({ folder: card.cwd, target: entry.url, cardId: id });
  return { address: `${tunnel.address}${new URL(entry.url).pathname.replace(/^\/$/, "")}` };
}

export function devStopVerb({ id }: { id: string }): Promise<Ok> {
  return settle(() => {
    requireCard(id);
    stopDev(id);
    return OK;
  });
}
