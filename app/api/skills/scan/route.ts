import { connection } from "next/server";
import { fail, guard } from "@/lib/guard";
import { scanLibrary } from "@/lib/skill-scan-library";

// The static scan of every skill and plugin in ?cwd='s library, keyed by name or plugin id (lib/skill-scan-library.ts).
// Cached by each folder's files, so only a skill that changed is read again.
export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  try {
    return Response.json({ scans: scanLibrary(new URL(req.url).searchParams.get("cwd") || undefined) });
  } catch (err) {
    return fail(err);
  }
}
