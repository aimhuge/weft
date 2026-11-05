import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { readTeamBoard, teamThreadPage, teamToolOutput } from "@/lib/team-board";

// Your teammates' cards for the projects you've checked out here (lib/team-board.ts), read-only: GET lists them
// (since= only the ones changed after it), GET ?org=&card= reads a page of a card's thread (before= walks back,
// after= sends only the items past that seq), and GET ?org=&card=&tool= a full tool result. There is no POST: a
// teammate's Mac takes no commands from you (docs/architecture/cloud-sync.md#team-projects-on-the-desktop-board).
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
