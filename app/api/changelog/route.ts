import { entriesFor } from "@/lib/changelog";
import { guard } from "@/lib/guard";
import { projectRoot } from "@/lib/quality-files";

// A project's changelog (lib/changelog.ts) for the Changelog dialog: GET ?folder= lists its entries, newest first.
// Nothing here writes CHANGELOG.md; Weft does that after each commit (lib/changelog-write.ts).

export function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const folder = new URL(req.url).searchParams.get("folder");
  if (!folder) return Response.json({ error: "folder is required" }, { status: 400 });
  const project = projectRoot(folder);
  return Response.json({ project, entries: entriesFor(project).reverse() });
}
