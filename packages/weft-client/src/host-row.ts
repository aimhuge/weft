// A `host` command's row (./host-command.ts), built without HOST_API: the table loads the server's handlers, and
// weft.zip builds these rows in the browser (lib/cloud-host-acts.ts). hostCommand checks the verb first; a caller
// here names only verbs the table has, which HostVerb's type holds it to. lib/host-row.ts re-exports it.
import type { HostVerb } from "./host-verbs";

// args always name the card the verb acts on; the rest is the verb's own (lib/host-api/calls.ts).
export type HostArgs = Record<string, unknown> & { id: string };

export interface HostPayload {
  verb: HostVerb;
  args: HostArgs;
}

// Where a card runs: the row is addressed to that machine and folder.
export type CardTarget = { orgId: string; device: string; folder: string; cardId: string };

// The columns of a host row a board inserts: lib/cloud-commands.ts's NewCommand with kind "host", which it fits
// (lib/host-row.test.ts checks).
export interface HostCommandRow {
  org_id: string;
  kind: "host";
  target_device: string;
  folder: string;
  payload: HostPayload;
}

// args.id is always the target's card, so a row can't be addressed to one card and act on another.
export function hostRow(target: CardTarget, verb: HostVerb, args: Record<string, unknown> = {}): HostCommandRow {
  const payload: HostPayload = { verb, args: { ...args, id: target.cardId } };
  return { org_id: target.orgId, kind: "host", target_device: target.device, folder: target.folder, payload };
}
