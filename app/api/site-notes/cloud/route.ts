// Shared site notes on weft.zip (docs/architecture/site-notes.md#share): GET the notes a user may read for a
// host, POST an upload or a success/failure report. Like /api/teams, the bearer token (the desktop's own
// Supabase access token) is the check, and the service role is the only key to the tables; the rules are
// lib/site-notes-cloud.ts. 503 when the deployment has no service key.
import { connection } from "next/server";
import { z } from "zod";
import { notesForHost, reportOutcome, uploadNote, type CloudResult } from "@/lib/site-notes-cloud";
import { supabaseNotesDb } from "@/lib/site-notes-db";
import { bearerUser, serviceClient } from "@/lib/web-session";

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upload"),
    host: z.string().min(1).max(253),
    path: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
    scope: z.enum(["team", "public"]),
    orgId: z.uuid().optional(),
  }),
  z.object({ action: z.literal("report"), versionId: z.uuid(), outcome: z.enum(["success", "failure"]), step: z.string().max(2000).optional() }),
]);

async function context(req: Request) {
  const service = serviceClient();
  if (!service) return { error: Response.json({ error: "unconfigured" }, { status: 503 }) };
  const user = await bearerUser(req);
  if (!user) return { error: Response.json({ error: "signed-out" }, { status: 401 }) };
  return { db: supabaseNotesDb(service), user };
}

function answer<T>(result: CloudResult<T>) {
  if (result.ok) return Response.json({ ok: true, value: result.value });
  return Response.json({ error: result.error, ...(result.findings ? { findings: result.findings } : {}) }, { status: result.status });
}

export async function GET(req: Request) {
  await connection();
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  const params = new URL(req.url).searchParams;
  const host = (params.get("host") ?? "").toLowerCase();
  return answer(await notesForHost(ctx.db, ctx.user.id, host, params.get("contributor") === "1"));
}

export async function POST(req: Request) {
  await connection();
  let body: z.infer<typeof BodySchema> | null = null;
  try {
    const parsed = BodySchema.safeParse(await req.json());
    body = parsed.success ? parsed.data : null;
  } catch {
    body = null;
  }
  if (!body) return Response.json({ error: "bad-request" }, { status: 400 });
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  if (body.action === "report") return answer(await reportOutcome(ctx.db, ctx.user.id, body));
  return answer(await uploadNote(ctx.db, ctx.user.id, { host: body.host, path: body.path, body: body.body, scope: body.scope, ...(body.orgId ? { orgId: body.orgId } : {}) }));
}
