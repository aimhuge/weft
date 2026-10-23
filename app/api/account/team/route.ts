import { connection } from "next/server";
import { accountClient } from "@/lib/account";
import { fail, guard } from "@/lib/guard";
import { forgetSyncOrg } from "@/lib/cloud-sync";
import { forwardTeam } from "@/lib/team-remote";

// The desktop's bridge to weft.zip's /api/teams (docs/architecture/teams.md). The board calls this
// from lib/use-team.ts; weft.zip's gate is its own, so this just forwards the bearer token and
// the JSON body, then passes the status and JSON back. POST is a write, so it needs the
// x-weft-token header the guard checks for.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const org = new URL(req.url).searchParams.get("org");
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const session = await accountClient().auth.getSession();
    const { status, json } = await forwardTeam("GET", query, undefined, { session, fetchFn: fetch, env: process.env });
    return Response.json(json, { status });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await connection();
  try {
    // weft.zip validates the body, so we pass it through untouched. The team op is a small
    // discriminated union (lib/team-types.ts), and the component shape matches what the form sends.
    const body = (await req.json()) as unknown;
    const session = await accountClient().auth.getSession();
    const { status, json } = await forwardTeam("POST", "", body, { session, fetchFn: fetch, env: process.env });
    // The deleted team may be the one this Mac's cards sync to: have the next flush look it up again.
    if (status === 200 && (body as { action?: unknown } | null)?.action === "delete") forgetSyncOrg();
    return Response.json(json, { status });
  } catch (err) {
    return fail(err);
  }
}
