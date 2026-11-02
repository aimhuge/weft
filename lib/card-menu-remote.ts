// A card's right-click menu on a host other than this Mac (a Weft Worker, docs/architecture/project-hosts.md): the same
// menu (lib/card-menu.ts), keeping only what a remote host's verbs back. Rename, Tags, Star, Archive and the column
// moves are card.update; Stop is card.stop; the modes and Run on are card.update and card.switchBackend; New Thread in
// This Folder starts one on that worker; Share… links its cloud rows (lib/card-share-worker.ts) and Delete… is
// card.delete. What's left out reads or widens this Mac (its folder, a shell skill, the dev server, the vault). The agent
// and skipping permission prompts widen the card, which the network may do only with a signed approval: kept when the
// board can sign one (`signed`). The desktop signs both with Touch ID (lib/widen-signer.ts); a passkey on weft.zip signs
// the agent, never skipping prompts (lib/widen-check.ts).
import type { MenuItem } from "./card-menu";

const REMOTE = /^(open|rename|start|move:.*|stop|mode:(default|acceptEdits|auto)|switch:.*|new-here|star|tags|share|archive|delete)$/;
export interface SignedMenu {
  agent?: boolean;
  skip?: boolean;
}

const isSeparator = (item: MenuItem) => !("id" in item);

export function remoteMenu(items: MenuItem[], signed: SignedMenu = {}): MenuItem[] {
  const kept: MenuItem[] = [];
  const keep = (id: string) => REMOTE.test(id) || (Boolean(signed.agent) && id.startsWith("agent:")) || (Boolean(signed.skip) && id === "mode:bypassPermissions");
  for (const item of items) {
    if (!isSeparator(item) && !("id" in item && keep(item.id))) continue;
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
