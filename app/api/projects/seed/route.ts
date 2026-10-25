import { resolveFolder } from "@/lib/folders";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { seedProject } from "@/lib/project-seed-run";

// The project menu's Re-seed Backlog: parks the project's starter cards again (deduped against the board).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!asText(body.path).trim()) throw new Error("Choose a project.");
    return Response.json({ added: await seedProject(resolveFolder(body.path), { force: true }) });
  } catch (err) {
    return fail(err);
  }
}
