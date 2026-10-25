import { resolveFolder } from "@/lib/folders";
import { asText } from "@/lib/format";
import { fail, guard } from "@/lib/guard";
import { intakeProject, intakeText } from "@/lib/project-intake";

// A project opened on the board: take in its .env files, the keys its code reads and its webhook routes
// (lib/project-intake.ts). The board calls it in the background and shows its intake screen when text says something happened.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!asText(body.folder).trim()) throw new Error("Choose a folder.");
    const result = await intakeProject(resolveFolder(body.folder));
    return Response.json({ ...result, text: intakeText(result) });
  } catch (err) {
    return fail(err);
  }
}
