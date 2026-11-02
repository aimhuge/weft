// A `host` command's row (lib/host-command.ts), built without HOST_API: the table loads the server's handlers, and
// weft.zip builds these rows in the browser (lib/cloud-host-acts.ts). hostCommand checks the verb first; a caller
// here names only verbs the table has, which HostVerb's type holds it to.
import type { NewCommand } from "./cloud-commands";
import type { HostVerb } from "./host-api/types";

// args always name the card the verb acts on; the rest is the verb's own (lib/host-api/calls.ts).
export type HostArgs = Record<string, unknown> & { id: string };

export interface HostPayload {
  verb: HostVerb;
  args: HostArgs;
}

// Where a card runs: the row is addressed to that machine and folder.
export type CardTarget = { orgId: string; device: string; folder: string; cardId: string };

// args.id is always the target's card, so a row can't be addressed to one card and act on another.
export function hostRow(target: CardTarget, verb: HostVerb, args: Record<string, unknown> = {}): NewCommand {
  const payload: HostPayload = { verb, args: { ...args, id: target.cardId } };
  return { org_id: target.orgId, kind: "host", target_device: target.device, folder: target.folder, payload };
}
