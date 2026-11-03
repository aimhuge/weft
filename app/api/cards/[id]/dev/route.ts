import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { hostFail, requireCard, runVerb } from "@/lib/host-api";

type Ctx = { params: Promise<{ id: string }> };

// The card's dev server status: the dev.status verb (lib/host-api/dev-servers.ts).
export async function GET(req: Request, { params }: Ctx) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  return runVerb("dev.status", { id }).then((r) => Response.json(r), (err: unknown) => hostFail(err));
}

// Each action is a dev.* host verb, mounted for this Mac's own cards (lib/host-api/dev-servers.ts): start runs the review
// tour's dev command unless its url already answers, restart starts it anew (dev.start); stop ends the server Weft
// started (dev.stop) and answers its status; open is a private address for it, after Touch ID (dev.open); rerun is the
// run's own command again (dev.restart); log its last lines (dev.log).
const DEV_VERBS: Partial<Record<string, "dev.open" | "dev.restart" | "dev.log">> = { open: "dev.open", rerun: "dev.restart", log: "dev.log" };

async function act(id: string, action: string | undefined): Promise<Response> {
  const verb = DEV_VERBS[action ?? ""];
  if (verb) return Response.json(await runVerb(verb, { id }));
  if (action === "start" || action === "restart") return Response.json(await runVerb("dev.start", { id, restart: action === "restart" }));
  if (action !== "stop") return fail("Unknown action.");
  await runVerb("dev.stop", { id });
  return Response.json(await runVerb("dev.status", { id }));
}

export async function POST(req: Request, { params }: Ctx) {
  const denied = guard(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    // A missing card is a 404 before the body is read.
    requireCard(id);
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    return await act(id, action);
  } catch (err) {
    return hostFail(err);
  }
}
