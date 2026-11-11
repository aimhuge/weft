import os from "node:os";
import { connection } from "next/server";
import { prewarm } from "@/lib/copilot";
import { elevated, guard } from "@/lib/guard";
import { hostFail, needsElevation, runVerb } from "@/lib/host-api";
import { deskClient } from "@/lib/turn-env";
import { warmHostFacts } from "@/lib/host-facts";
import { startWorkerThread, type WorkerThreadInput } from "@/lib/worker-new-thread";
import { isWorkerProject } from "@/lib/worker-project";
import { watchWorkerRun } from "@/lib/worker-refused";

// The board's cards and worktree roots are the card.list verb (lib/host-api/card-list.ts); home is this Mac's own.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  prewarm();
  // The <weft-env> block's commit and behind count, read once in the background (lib/host-facts.ts).
  void warmHostFacts();
  const { cards, roots } = await runVerb("card.list", undefined);
  return Response.json({ cards, home: os.homedir(), roots });
}

// A new card is the card.create verb (lib/host-api/card-create.ts), run as this host's own caller: a fresh id, and a
// project switched to "Run on Worker" hands its first message to your worker (lib/worker-handoff.ts).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    // A thread may create cards with its curl, but not cards that ask less than the default (lib/guard.ts elevated).
    const loose = needsElevation("card.create", { ...body, id: "" }) ? elevated(req) : null;
    if (loose) return loose;
    // A worker project has no folder here: a new thread goes to the worker as card.create (started, or into its
    // Backlog) or says why it can't, and no card is made on this Mac. It comes back through the cloud rows.
    if (isWorkerProject(body.cwd as string | undefined)) {
      // Only Weft's own window gets the start signed for the GitHub connector, never a thread's curl (lib/worker-folder-repo.ts).
      const fromBoard = elevated(req) === null;
      const input = { ...(body as unknown as WorkerThreadInput), start: body.start === true, signStart: fromBoard };
      const { worker, cardId, commandId } = await startWorkerThread(input);
      // A run the worker refuses lands on this board instead of vanishing (lib/worker-refused.ts).
      if (commandId) void watchWorkerRun(commandId, worker, input);
      return Response.json({ card: null, start: { started: false, worker, cardId } });
    }
    // Who asked, for its first turn's <weft-env> block; set here, whatever the body said (lib/turn-client.ts). The id is
    // this host's to pick (""), as it always was.
    const args = { ...body, id: "", client: deskClient(elevated(req) === null), start: Boolean(body.start) };
    return Response.json(await runVerb("card.create", args, { local: true }));
  } catch (err) {
    return hostFail(err);
  }
}
