import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { qaState } from "@/lib/qa-switch";
import { workerBlobUrls, workerThreadSearch } from "@/lib/worker-thread-reads";
import { openWorkerLine, readWorkerBoard, sendWorkerAction, workerThreadPage, workerToolOutput, type LineAction, type WorkerAction } from "@/lib/worker-board";
import { workerProjectSnapshot, workerResultBlob } from "@/lib/worker-board-reads";
import { pinWorkerPasskeys, type PinAction } from "@/lib/worker-pin";
import { readWorkerAsk } from "@/lib/worker-ask-read";

// Your Weft Workers' projects on the desktop board (lib/worker-board.ts): GET lists them with their cards, GET ?card=
// reads a page of that card's thread (before= walks back, after= sends only the items past that seq), since= only the
// cards changed after it, GET ?card=&tool= reads a full tool result, GET ?project= a worker project's snapshot for the
// header badges, GET ?blob= a host verb's answer too big for its row (the editor's), GET ?card=&q= finds q over the
// whole thread, GET ?ask=<card> the card's row for Electron main to sign an Allow over (lib/worker-ask-read.ts), GET ?blobs=<ref>,<ref> signs the blob refs a thread's pictures name (lib/worker-thread-reads.ts), and POST sends
// a reply, an answer, a stop, a mode, a tap or any host verb as a cloud_commands row, a session line's sealed offer, or a
// Mac's passkey endorsements (pin). A new thread goes through POST /api/cards like any other.

// The reads that aren't a thread's: a worker project's snapshot, a verb's oversized answer, a thread's picture refs
// signed, and a card's row for main to sign an Allow over (electron/approval-sign.cjs).
async function blobReads(params: URLSearchParams): Promise<Response | null> {
  const ask = params.get("ask");
  if (ask) return Response.json({ ask: await readWorkerAsk(ask) });
  const project = params.get("project");
  if (project) return Response.json(await workerProjectSnapshot(project));
  const blob = params.get("blob");
  if (blob) return Response.json(await workerResultBlob(blob));
  const blobs = params.get("blobs");
  return blobs === null ? null : Response.json({ urls: await workerBlobUrls(blobs.split(",")) });
}

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const params = new URL(req.url).searchParams;
  const card = params.get("card");
  try {
    // What the Local Simulator switch shows: this Mac's own devices, and whether this card is approved here.
    if (params.has("devices")) return Response.json(await qaState(card));
    const blobRead = await blobReads(params);
    if (blobRead) return blobRead;
    const sinceParam = params.get("since");
    const since = sinceParam && Number.isFinite(Date.parse(sinceParam)) ? sinceParam : undefined;
    if (!card) return Response.json(await readWorkerBoard(undefined, undefined, undefined, since));
    const tool = params.get("tool");
    if (tool) return Response.json({ result: await workerToolOutput(card, tool) });
    const q = params.get("q");
    if (q !== null) {
      const matches = await workerThreadSearch(card, q);
      return matches ? Response.json({ matches }) : Response.json({ error: "That thread can't be searched." }, { status: 502 });
    }
    const before = params.get("before");
    const after = Number(params.get("after") ?? Number.NaN);
    const page = await workerThreadPage(card, before === null ? undefined : Number(before), undefined, Number.isInteger(after) ? after : undefined);
    return page ? Response.json(page) : Response.json({ error: "That thread can't be read." }, { status: 502 });
  } catch (err) {
    return fail(err, 502);
  }
}

const ELEVATED = new Set<(WorkerAction | LineAction | PinAction)["action"]>(["answer", "mode", "input", "qa", "host", "line", "pin"]);

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as WorkerAction | LineAction | PinAction;
    // An answer can allow a call or grant a folder, so it takes Weft's own window, like the local permission route:
    // a thread's curl must not approve its own prompt on a worker. A mode widens what a thread may do, and input drives
    // the device, so they take it too, and Local Simulator runs a worker's build on this Mac. A host verb can be any of
    // those, so it always takes it: a cloud act is elevated by construction (docs/architecture/project-hosts.md).
    const loose = ELEVATED.has(body.action) ? elevated(req) : null;
    if (loose) return loose;
    // A session line carries every verb, so its offer takes Weft's own window too.
    if (body.action === "line") return Response.json(await openWorkerLine(body));
    // A Mac's signed passkey endorsements for a worker (lib/worker-pin.ts): Weft's own window, like the rest.
    if (body.action === "pin") return Response.json(await pinWorkerPasskeys(body));
    return Response.json(await sendWorkerAction(body));
  } catch (err) {
    return fail(err);
  }
}
