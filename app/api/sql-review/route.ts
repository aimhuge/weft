import { connection } from "next/server";
import { elevated, fail, guard } from "@/lib/guard";
import { setSqlAutoAccept, sqlAutoAccept } from "@/lib/db-calls";

// Settings → Security → "Accept harmless SQL" (lib/db-calls.ts): GET the switch, PUT it. Letting SQL through unasked
// is the user's call, so the write takes Weft's own window (elevated), never a thread's curl.

export async function GET(req: Request) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  await connection();
  return Response.json({ autoAccept: sqlAutoAccept() });
}

export async function PUT(req: Request) {
  const denied = elevated(req);
  if (denied) return denied;
  try {
    const { autoAccept } = (await req.json()) as { autoAccept?: unknown };
    if (typeof autoAccept !== "boolean") throw new Error("autoAccept must be true or false.");
    setSqlAutoAccept(autoAccept);
    return Response.json({ autoAccept });
  } catch (err) {
    return fail(err);
  }
}
