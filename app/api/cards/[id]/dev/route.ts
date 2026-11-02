import { connection } from "next/server";
import { devStatus, reachable, startDev, stopDev } from "@/lib/devserver";
import { fail, guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";
import { getCard } from "@/lib/store";
import { workDir } from "@/lib/work-dir";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  const card = getCard(id);
  if (!card) return fail("No such card.", 404);
  return Response.json({ status: await devStatus(id, card.review?.url) });
}

// start: run the plan's dev command unless its url already answers; stop: end the server Weft started (dev.stop);
// open: a private address for the card's server, after Touch ID (dev.open, lib/host-api/dev-servers.ts); rerun: the
// run's own command again (dev.restart); log: its last lines (dev.log). restart is the review tour's plan, started anew.
// The actions that are a dev.* host verb as they are, mounted for this Mac's own cards.
const DEV_VERBS: Partial<Record<string, "dev.open" | "dev.restart" | "dev.log">> = { open: "dev.open", rerun: "dev.restart", log: "dev.log" };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  const card = getCard(id);
  if (!card) return fail("No such card.", 404);
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const plan = card.review;
  const verb = DEV_VERBS[action ?? ""];
  if (verb) return runVerb(verb, { id }).then((r) => Response.json(r), (err: unknown) => hostFail(err));
  if (action === "stop") await runVerb("dev.stop", { id });
  else if (action === "start" || action === "restart") {
    if (!plan?.dev) return fail("The review tour has no dev command.");
    if (action === "restart") stopDev(id);
    else if (plan.url && (await reachable(plan.url))) return Response.json({ status: await devStatus(id, plan.url) });
    const { url } = await startDev(id, plan.dev, workDir(card), card.title, plan.url);
    return Response.json({ status: await devStatus(id, url) });
  } else return fail("Unknown action.");
  return Response.json({ status: await devStatus(id, plan?.url) });
}
