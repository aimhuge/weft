import { connection } from "next/server";
import { githubOrgRepos, githubOrgs } from "@/lib/github-orgs";
import { fail, guard } from "@/lib/guard";

// Your GitHub orgs, for a new team's name (GET), or one org's repos, to suggest as the team's projects
// (GET ?org=x). Both through the gh CLI (lib/github-orgs.ts).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const org = new URL(req.url).searchParams.get("org");
    if (org) return Response.json({ repos: await githubOrgRepos(org) });
    return Response.json(await githubOrgs());
  } catch (err) {
    return fail(err);
  }
}
