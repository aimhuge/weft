// One account's activity for the admin Users drawer: the last 12 weeks day by day (admin_user_activity, from
// supabase/migrations/20261025181950_user_active_days.sql) and the summary lib/admin-activity.ts works out from it.
// Same gate as the Users list: a super-admin, then the service client that reads across accounts.
import { adminServiceClient, requireSuperAdminWeft } from "@/lib/admin";
import { summarize, toUserActivity } from "@/lib/admin-activity";
import { fail, guard } from "@/lib/guard";

const DAYS = 84;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Rpc {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = guard(req, { write: false });
  if (denied) return denied;
  try {
    await requireSuperAdminWeft();
    const { id } = await params;
    if (!UUID.test(id)) return Response.json({ error: "Not an account id." }, { status: 400 });
    const service = (await adminServiceClient()) as unknown as Rpc | null;
    if (!service) return Response.json({ error: "SUPABASE_SECRET_KEY is not set." }, { status: 503 });
    const { data, error } = await service.rpc("admin_user_activity", { uid: id, days: DAYS });
    if (error) throw new Error(error.message ?? "Couldn't read the activity.");
    const activity = toUserActivity(data);
    return Response.json({ ...activity, summary: summarize(activity.days) });
  } catch (err) {
    return fail(err);
  }
}
