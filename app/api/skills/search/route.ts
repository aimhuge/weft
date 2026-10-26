import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { searchSkills } from "@/lib/skill-registry";

// Skills on skills.sh matching ?q=, each marked installed when ?cwd='s library has one by that name (lib/skill-registry.ts).
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    return Response.json({ skills: await searchSkills(params.get("q") ?? "", params.get("cwd") || undefined) });
  } catch (err) {
    return fail(err, 502);
  }
}
