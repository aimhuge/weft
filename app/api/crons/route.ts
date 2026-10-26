import { getCron, listCrons } from "@/lib/cron-store";
import { runCron } from "@/lib/cron-run";
import type { CronInput } from "@/lib/cron-types";
import { createCron } from "@/lib/crons";
import { fail, guard } from "@/lib/guard";

// The rail's Crons drawer: every cron, soonest run first.
export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const crons = listCrons().sort((a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity));
  return Response.json({ crons });
}

// The ⏰ popover makes one (docs/architecture/crons.md); runNow fires its first run as it's made.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const input = (await req.json()) as CronInput;
    const cron = createCron({ ...input, by: "you" });
    if (!input.runNow) return Response.json({ cron });
    await runCron(cron.id);
    // As it stands after its first run: counted, with the run's card.
    return Response.json({ cron: getCron(cron.id) ?? cron });
  } catch (err) {
    return fail(err);
  }
}
