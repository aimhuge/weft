import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/account";
import { billingService } from "@/lib/billing/billing";
import { blastcpAnswer } from "@/lib/billing/blastcp-bundle";
import { accountUserId } from "@/lib/puku-trial-token";

// The BlastCP tier a Weft user's plan includes (docs/architecture/billing.md "BlastCP usage"). BlastCP's server calls it
// with the user's Weft access token while it handles Weft's token exchange or plan sync, and sets the user's own BlastCP
// workspace to the answer. Like /api/billing/status, the Weft access token is the check: it only ever answers for the
// person it belongs to. 401 on a missing or expired token, 503 without the service key, `{ tier, until }` otherwise.

export async function GET(req: Request) {
  const accessToken = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (!accessToken) return Response.json({ error: "A Weft access token is required." }, { status: 401 });
  const service = billingService();
  if (!service) return Response.json({ error: "Billing isn't set up on this Weft." }, { status: 503 });
  try {
    const userId = await accountUserId(accessToken, SUPABASE_URL, SUPABASE_KEY);
    if (!userId) return Response.json({ error: "That Weft sign-in has expired." }, { status: 401 });
    return Response.json(await blastcpAnswer(service, userId));
  } catch (err) {
    console.error(`BlastCP tier: ${(err as Error).message}`);
    return Response.json({ error: "Couldn't read the Weft plan." }, { status: 502 });
  }
}
