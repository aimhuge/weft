import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { installSkill, previewSkill, SkillInstallError } from "@/lib/skill-install";
import { SKILL_ID } from "@/lib/skill-registry";

// A skills.sh skill: GET ?id= previews it (files, static scan, any AI review), POST { id, force } installs it
// into ~/.claude/skills (lib/skill-install.ts). A dangerous one needs force.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    const params = new URL(req.url).searchParams;
    const id = params.get("id") ?? "";
    if (!SKILL_ID.test(id)) return Response.json({ error: "Pass ?id=owner/repo/skill." }, { status: 400 });
    return Response.json(await previewSkill(id, params.get("cwd") || undefined));
  } catch (err) {
    return fail(err, 502);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { id?: unknown; force?: unknown };
    if (typeof body.id !== "string" || !SKILL_ID.test(body.id)) return Response.json({ error: "id is required." }, { status: 400 });
    const { name, scan } = await installSkill(body.id, { force: body.force === true });
    return Response.json({ name, scan });
  } catch (err) {
    if (err instanceof SkillInstallError) return Response.json({ error: err.message, scan: err.scan }, { status: err.status });
    return fail(err);
  }
}
