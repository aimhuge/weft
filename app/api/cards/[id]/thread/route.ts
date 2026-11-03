import { connection } from "next/server";
import { guard } from "@/lib/guard";
import { hostFail, runVerb } from "@/lib/host-api";

// The thread, or a page of it: the thread.page verb (lib/host-api/thread.ts). ?before=<n>&limit=<n> pages it, newest
// first (lib/thread-page.ts); with neither the whole thread comes back, so older clients keep working.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  const { id } = await params;
  const url = new URL(req.url);
  const param = (name: string) => {
    const value = url.searchParams.get(name);
    return value === null ? undefined : Number(value);
  };
  return runVerb("thread.page", { id, before: param("before"), limit: param("limit") }).then((r) => Response.json(r), (err: unknown) => hostFail(err));
}
