import { listAgents } from "@/lib/agent-store";
import { elevated, fail } from "@/lib/guard";
import { myShares, readTeamCache } from "@/lib/team-agent-cache";
import { shareAgent, unshareAgent } from "@/lib/team-agents";

type Ctx = { params: Promise<{ id: string }> };

// Share one of your agents with a Weft team (POST { org }), or stop (DELETE { org }); answers the new list. Weft's own
// window only, like every change to an agent: what it shares is a system prompt for every member.

async function change(req: Request, { params }: Ctx, run: (id: string, org: string) => Promise<void>) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { org?: unknown };
    if (typeof body.org !== "string" || !body.org) throw new Error("Which team?");
    await run((await params).id, body.org);
    return Response.json({ agents: listAgents(), teams: readTeamCache().teams, shares: myShares() });
  } catch (err) {
    return fail(err);
  }
}

export const POST = (req: Request, ctx: Ctx) => change(req, ctx, shareAgent);
export const DELETE = (req: Request, ctx: Ctx) => change(req, ctx, unshareAgent);
