// A card's right-click menu on a host other than this Mac (a Weft Worker, docs/architecture/project-hosts.md): the same
// menu (lib/card-menu.ts), keeping only what a remote host's verbs back. Rename, Tags, Star, Archive and the column
// moves are card.update; Stop is card.stop; the modes (plan too, which a worker takes) and Run on are card.update and
// card.switchBackend; Run /<skill> is just a message, "/<skill>" through card.message; New Thread in This Folder starts
// one on that worker; Share… links its cloud rows (lib/card-share-worker.ts) and Delete… is card.delete. What's left out
// reads or widens this Mac (its folder, the dev server, the vault) or changes the card's agent (refused from the
// network, lib/host-command.ts remoteRefusal). Skipping permission prompts is refused from the network too.
import type { MenuItem } from "./card-menu";

const REMOTE = /^(open|rename|start|move:.*|stop|skill:.+|mode:(default|acceptEdits|auto|plan)|switch:.*|new-here|star|tags|share|archive|delete)$/;

const isSeparator = (item: MenuItem) => !("id" in item);

export function remoteMenu(items: MenuItem[]): MenuItem[] {
  const kept: MenuItem[] = [];
  for (const item of items) {
    if (!isSeparator(item) && !("id" in item && REMOTE.test(item.id))) continue;
    // One separator between groups and none to start with, now that whole groups may be gone.
    const last = kept.at(-1);
    if (isSeparator(item) && (!last || isSeparator(last))) continue;
    kept.push(item);
  }
  // Nor one to end with.
  const end = kept.at(-1);
  if (end && isSeparator(end)) kept.pop();
  return kept;
}
