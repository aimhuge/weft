// cron.create: the ⏰ popover's new cron, made from a card (docs/architecture/crons.md). args.id is the card: each run
// takes its folder, CLI, mode, model, effort and agent (lib/crons.ts workOf), so the args carry only what the popover
// asks (prompt, schedule, name, fork or fresh, the message to fork at, a window, on or off, run now). On this Mac it's
// what POST /api/crons does; on a Weft Worker the cron lives and fires there. permissionMode, when given, is the mode
// the host narrows it to for a cron made from the network (lib/worker-kinds.ts listVerb); remoteRefusal keeps a row
// from naming it (@weft/client list-policy.ts cronCreateRefusal).
import { runCron } from "../cron-run";
import { getCron } from "../cron-store";
import type { Cron, CronInput } from "../cron-types";
import { createCron, updateCron } from "../crons";
import type { PermissionMode } from "../types";
import { requireCard } from "./types";

export type CronCreateArgs = Pick<CronInput, "prompt" | "expr" | "name" | "mode" | "fromMessage" | "enabled" | "startsAt" | "endsAt" | "runNow"> & {
  id: string;
  permissionMode?: PermissionMode;
};

export async function cronCreateVerb({ id, permissionMode, runNow, ...input }: CronCreateArgs): Promise<{ cron: Cron }> {
  requireCard(id);
  const made = createCron({ ...input, cardId: id, by: "you" });
  const cron = permissionMode && permissionMode !== made.permissionMode ? updateCron(made.id, { permissionMode }) : made;
  if (!runNow) return { cron };
  await runCron(cron.id);
  // As it stands after its first run: counted, with the run's card.
  return { cron: getCron(cron.id) ?? cron };
}
