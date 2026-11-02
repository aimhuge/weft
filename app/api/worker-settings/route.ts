import { elevated, fail } from "@/lib/guard";
import { sendWorkerHostVerb, type WorkerHostAction } from "@/lib/worker-host-verbs";

// One of your workers' own settings (Settings → Threads, components/WorkerHostSettings.tsx): POST { workerId, verb:
// "settings.get" | "settings.put", args? } queues the verb as a `host` row and answers its commandId; the board follows
// it through GET /api/workers?command=. Elevated: a thread's curl must not retune a worker (lib/guard.ts).
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<WorkerHostAction>;
    if (typeof body.workerId !== "string" || !body.workerId) return Response.json({ error: "Choose a worker." }, { status: 400 });
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : undefined;
    return Response.json(await sendWorkerHostVerb({ workerId: body.workerId, verb: typeof body.verb === "string" ? body.verb : "", args }));
  } catch (err) {
    return fail(err, 502);
  }
}
