import { connection } from "next/server";
import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";
import { listSkills } from "@/lib/skills";

// The skills a thread can run: Weft's own, yours in ~/.claude/skills, and with ?cwd= that folder's. With ?card=, the
// card's own folder's, as the skills.list verb (lib/host-api) a worker runs for its cards.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    const card = params.get("card");
    if (card) return Response.json(await runVerb("skills.list", { id: card }));
    return Response.json({ skills: listSkills(params.get("cwd") || undefined) });
  } catch (err) {
    return hostFail(err);
  }
}
