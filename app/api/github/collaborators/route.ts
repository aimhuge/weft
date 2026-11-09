import { connection } from "next/server";
import { githubCollaborators, githubEmail } from "@/lib/github-collaborators";
import { fail, guard } from "@/lib/guard";

// People to invite to a team: GET ?repos=a/b,c/d is each repo's GitHub collaborators, plus the members of ?org=x
// when the team was made from a GitHub org; GET ?login=x is one login's public email, for inviting by @login
// (lib/github-collaborators.ts).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    const login = params.get("login");
    if (login) return Response.json({ email: await githubEmail(login) });
    const repos = (params.get("repos") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    const org = params.get("org");
    return Response.json(await (org ? githubCollaborators(repos, Date.now(), org) : githubCollaborators(repos)));
  } catch (err) {
    return fail(err);
  }
}
