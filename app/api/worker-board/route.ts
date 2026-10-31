import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { readWorkerBoard, sendWorkerAction, workerThreadPage, workerToolOutput, type WorkerAction } from "@/lib/worker-board";

// Your Weft Workers' projects on the desktop board (lib/worker-board.ts): GET lists them with their cards, GET ?card=
// reads a page of that card's thread (before= walks back), GET ?card=&tool= reads a full tool result, and POST sends
// a reply, an answer, a stop, a mode or a tap as a cloud_commands row. A new thread goes through POST /api/cards like any other.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const params = new URL(req.url).searchParams;
  const card = params.get("card");
  try {
    if (!card) return Response.json(await readWorkerBoard());
    const tool = params.get("tool");
    if (tool) return Response.json({ result: await workerToolOutput(card, tool) });
    const before = params.get("before");
    const page = await workerThreadPage(card, before === null ? undefined : Number(before));
    return page ? Response.json(page) : Response.json({ error: "That thread can't be read." }, { status: 502 });
  } catch (err) {
    return fail(err, 502);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as WorkerAction;
    // An answer can allow a call or grant a folder, so it takes Weft's own window, like the local permission route:
    // a thread's curl must not approve its own prompt on a worker. A mode widens what a thread may do, and input drives
    // the device, so they take it too.
    const loose = body.action === "answer" || body.action === "mode" || body.action === "input" ? elevated(req) : null;
    if (loose) return loose;
    return Response.json(await sendWorkerAction(body));
  } catch (err) {
    return fail(err);
  }
}
