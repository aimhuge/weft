import { connection } from "next/server";
import { githubCollaborators } from "@/lib/github-collaborators";
import { fail, guard } from "@/lib/guard";

// People to invite to a team: GET ?repos=a/b,c/d is each repo's GitHub collaborators (lib/github-collaborators.ts).

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const repos = (new URL(req.url).searchParams.get("repos") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
    return Response.json(await githubCollaborators(repos));
  } catch (err) {
    return fail(err);
  }
}
