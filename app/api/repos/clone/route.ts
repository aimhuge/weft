import { connection } from "next/server";
import { cloneProgress } from "@/lib/clone-progress";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { cloneRepo } from "@/lib/repos";
import { listProjects, touchProject } from "@/lib/settings";

// How far the clone of ?fullName= has got (lib/clone-progress.ts), polled while the POST below runs; null when none.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json(cloneProgress(new URL(req.url).searchParams.get("fullName")?.trim() ?? ""));
}

// Clones a GitHub repo into ~/dev (or finds the clone that's already here) and adds it to the recent projects.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const folder = await cloneRepo(asText(body.fullName).trim());
    touchProject(folder);
    return Response.json({ path: folder, projects: listProjects() });
  } catch (err) {
    return fail(err);
  }
}
