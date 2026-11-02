import path from "node:path";
import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { backlogOf } from "@/lib/project-summaries";
import { sprintPrompt } from "@/lib/sprint-plan";
import { listCards } from "@/lib/store";

// The Backlog of the repo holding ?cwd= (or of that folder when it isn't a repo), for the header
// counter: how many cards wait there. With &prompt=1, the first message of a card that plans them into
// sprints (lib/sprint-plan.ts); the board starts that card through /api/cards.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const url = new URL(req.url);
  const cwd = url.searchParams.get("cwd");
  if (!cwd) return Response.json({ backlog: null });
  try {
    const found = backlogOf(cwd, listCards());
    if (!found) return Response.json({ backlog: null });
    const { root, map, summary } = found;
    if (!url.searchParams.get("prompt")) return Response.json({ backlog: summary });
    const prompt = sprintPrompt({ root, map, origin: url.origin, now: Date.now() });
    return Response.json({ backlog: summary, prompt, title: `Plan the ${path.basename(root)} backlog into sprints` });
  } catch (err) {
    return fail(err, 500);
  }
}
