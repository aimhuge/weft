import { connection } from "next/server";
import { resolveFolder } from "@/lib/folders";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { listProjects, markProject, removeProject, touchProject } from "@/lib/settings";

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ projects: listProjects() });
}

// Adds an existing folder to the recent projects (or marks it as just used).
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    // resolveFolder treats an empty path as the home folder, which is never what's meant here.
    if (!asText(body.path).trim()) throw new Error("Choose a folder.");
    const folder = resolveFolder(body.path);
    touchProject(folder);
    return Response.json({ path: folder, projects: listProjects() });
  } catch (err) {
    return fail(err);
  }
}

// Drops a folder from the recent projects. The folder itself is left alone, and it may no longer exist.
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    removeProject(asText(body.path));
    return Response.json({ projects: listProjects() });
  } catch (err) {
    return fail(err);
  }
}

// Pins or hides a project in the bar, from its right-click menu (lib/project-menu.ts). Only the marks sent change.
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const path = asText(body.path);
    if (!path.trim()) throw new Error("Choose a folder.");
    const marks: { pinned?: boolean; hidden?: boolean } = {};
    if (typeof body.pinned === "boolean") marks.pinned = body.pinned;
    if (typeof body.hidden === "boolean") marks.hidden = body.hidden;
    markProject(path, marks);
    return Response.json({ projects: listProjects() });
  } catch (err) {
    return fail(err);
  }
}
