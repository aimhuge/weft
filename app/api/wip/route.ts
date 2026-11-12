import { connection } from "next/server";
import { elevated, fail } from "@/lib/guard";
import { pulledNote, pullWip } from "@/lib/wip-pull";

// A project menu's "Pull Uncommitted Work from <worker>" (lib/wip-pull.ts): POST { folder, from } asks the Weft Worker
// whose project `from` names (worker://<id>/<folder>) for its uncommitted work and checks it out in `folder`. It
// rewrites this Mac's working tree and makes the worker push, so only Weft's own window may ask (lib/guard.ts
// elevated), never a thread's curl.
export async function POST(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  await connection();
  const body = (await req.json().catch(() => ({}))) as { folder?: unknown; from?: unknown };
  if (typeof body.folder !== "string" || !body.folder || typeof body.from !== "string" || !body.from) return Response.json({ error: "Which project, and from where?" }, { status: 400 });
  try {
    const pulled = await pullWip(body.folder, body.from);
    return Response.json({ ...pulled, note: pulledNote(pulled) });
  } catch (err) {
    return fail(err, 400);
  }
}
