import { SUPABASE_URL } from "@/lib/account";
import { handlePush, restPing } from "@/lib/worker-push";

// GitHub's push webhook for aimhuge/weft, on the deployed Weft (lib/worker-push.ts). No localhost guard, as
// /api/github/webhook: GitHub is the caller and the signature is the check. Both values are set on the deployment
// only; a Weft without them says so.

export async function POST(req: Request) {
  const key = process.env.SUPABASE_SECRET_KEY;
  const secret = process.env.WORKER_PUSH_WEBHOOK_SECRET;
  if (!key || !secret) return new Response("The push webhook isn't set up on this Weft.", { status: 503 });
  try {
    return await handlePush(req, secret, restPing(SUPABASE_URL, key));
  } catch (err) {
    console.error(`Push webhook: ${(err as Error).message}`);
    return new Response("Couldn't ping the workers", { status: 502 });
  }
}
