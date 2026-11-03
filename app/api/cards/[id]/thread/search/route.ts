import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

// Find in a thread: which items hold ?q=, over the whole stored thread and every long tool result the board leaves out
// of what it loads: the thread.search verb (lib/host-api/thread.ts).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  const { id } = await params;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return runVerb("thread.search", { id, q }).then((r) => Response.json(r), (err: unknown) => hostFail(err));
}
