// Writes a folder grant on the machine running the card: This card goes on Card.readScope, Always on this machine's
// settings.allowedFolders. The folder guard (lib/folder-guard.ts) reads both live, so the running turn has it at once
// and the next session starts with it. Only for an answer that came as a command (lib/cloud-inbox.ts,
// lib/worker-daemon.ts): the directory comes from answerGrant (lib/cloud-commands.ts), never off the network.
import type { GrantScope } from "./cloud-commands";
import { withReadScope } from "./read-scope";
import { allowFolder } from "./settings";
import { getCard, updateCard } from "./store";

export function applyFolderGrant(cardId: string, directory: string, scope: GrantScope) {
  const card = getCard(cardId);
  if (scope === "always") allowFolder(directory);
  else if (card) updateCard(cardId, { readScope: withReadScope(card.readScope, directory, card.cwd) });
}
