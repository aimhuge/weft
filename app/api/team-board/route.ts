import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { readTeamBoard, teamThreadPage, teamToolOutput } from "@/lib/team-board";
import { askHandover } from "@/lib/handover";
import { takeOverTeamCard } from "@/lib/team-takeover";

// Your teammates' cards for the projects you've checked out here (lib/team-board.ts), read-only: GET lists them
// (since= only the ones changed after it), GET ?org=&card= reads a page of a card's thread (before= walks back,
// after= sends only the items past that seq), and GET ?org=&card=&tool= a full tool result. Their Mac takes no
// commands from you (docs/architecture/cloud-sync.md#team-projects-on-the-desktop-board): POST { org, card } takes a
// card over by continuing it as a new card of yours on this Mac (lib/team-takeover.ts), and asks nothing of theirs;
// with ask: true it asks them for it instead (lib/handover.ts), which their Mac shows them and only acts on if they say yes.
const ORG_RE = /^[0-9a-f-]{36}$/;

const intOr = (value: string | null) => {
  const n = Number(value ?? Number.NaN);
  return Number.isInteger(n) ? n : undefined;
};

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const params = new URL(req.url).searchParams;
  const card = params.get("card");
  const org = params.get("org");
  try {
    if (!card) {
      const since = params.get("since");
      return Response.json(await readTeamBoard(undefined, since && Number.isFinite(Date.parse(since)) ? since : undefined));
    }
    if (!org || !ORG_RE.test(org)) return Response.json({ error: "Which workspace is that thread in?" }, { status: 400 });
    const tool = params.get("tool");
    if (tool) return Response.json({ result: await teamToolOutput(org, card, tool) });
    const page = await teamThreadPage(org, card, intOr(params.get("before")), intOr(params.get("after")));
    return page ? Response.json(page) : Response.json({ error: "That thread can't be read." }, { status: 502 });
  } catch (err) {
    return fail(err, 502);
  }
}

// "Continue here": a new card of yours from a teammate's, started at once. It runs a turn, so only Weft's own window
// may ask (lib/guard.ts elevated), not a thread's curl.
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  await connection();
  const body = (await req.json().catch(() => ({}))) as { org?: unknown; card?: unknown; ask?: unknown };
  if (typeof body.org !== "string" || !ORG_RE.test(body.org)) return Response.json({ error: "Which workspace is that card in?" }, { status: 400 });
  if (typeof body.card !== "string" || !body.card) return Response.json({ error: "Which card?" }, { status: 400 });
  try {
    return Response.json(body.ask === true ? await askHandover(body.org, body.card) : await takeOverTeamCard(body.org, body.card));
  } catch (err) {
    return fail(err, 400);
  }
}
