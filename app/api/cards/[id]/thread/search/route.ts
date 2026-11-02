import { fail, guard } from "@/lib/guard";
import { getCard, getThread } from "@/lib/store";
import { matchThread } from "@/lib/thread-find";

// Find in a thread: which items hold ?q=, over the whole stored thread and every long tool result the
// board leaves out of what it loads (lib/thread-find.ts).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const { id } = await params;
  if (!getCard(id)) return fail("No such card.", 404);
  const query = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ matches: matchThread(getThread(id), query) });
}
