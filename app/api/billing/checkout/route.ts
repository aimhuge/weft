import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/account";
import { billingService } from "@/lib/billing/billing";
import { startUpgrade, upgradeContextFor } from "@/lib/billing/checkout";
import { IP_COUNTRY_HEADER } from "@/lib/billing/regional-pick";
import type { UpgradeInterval, UpgradePlan } from "@/lib/billing/upgrade";
import { accountUserId } from "@/lib/puku-trial-token";

// The desktop's way into Stripe Checkout (docs/architecture/billing.md "The upgrade dialog"). Runs on the deployed
// Weft and, like /api/billing/status beside it, is reached from your machine with a Weft access token rather than a
// cookie, so it has no localhost guard. POST { plan: "pro" | "team", interval: "monthly" | "yearly" } answers
// { ok: true, url } with the Checkout page to open in the system browser, which returns to /checkout/done.

const PLANS: readonly string[] = ["pro", "team"];
const INTERVALS: readonly string[] = ["monthly", "yearly"];

async function readBody(req: Request): Promise<{ plan: UpgradePlan; interval: UpgradeInterval } | null> {
  const body = (await req.json().catch(() => null)) as { plan?: unknown; interval?: unknown } | null;
  if (typeof body?.plan !== "string" || !PLANS.includes(body.plan)) return null;
  const interval = body.interval ?? "monthly";
  if (typeof interval !== "string" || !INTERVALS.includes(interval)) return null;
  return { plan: body.plan as UpgradePlan, interval: interval as UpgradeInterval };
}

export async function POST(req: Request) {
  const accessToken = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  if (!accessToken) return Response.json({ ok: false, error: "Sign in to your Weft account first." }, { status: 401 });
  const choice = await readBody(req);
  if (!choice) return Response.json({ ok: false, error: "Pick Pro or Team, monthly or yearly." }, { status: 400 });
  const service = billingService();
  if (!service) return Response.json({ ok: false, error: "Billing isn't set up on this Weft." }, { status: 503 });
  let userId: string | null;
  try {
    userId = await accountUserId(accessToken, SUPABASE_URL, SUPABASE_KEY);
  } catch (err) {
    console.error(`Billing checkout: ${(err as Error).message}`);
    return Response.json({ ok: false, error: "Couldn't check your Weft sign-in." }, { status: 502 });
  }
  if (!userId) return Response.json({ ok: false, error: "Your Weft sign-in has expired. Sign in again." }, { status: 401 });
  try {
    const ctx = await upgradeContextFor(service, userId);
    if (!ctx) return Response.json({ ok: false, error: "No workspace for this account." }, { status: 404 });
    const ipCountry = req.headers.get(IP_COUNTRY_HEADER);
    return Response.json(await startUpgrade(ctx, { ...choice, ipCountry, returnPath: "/checkout/done" }));
  } catch (err) {
    console.error(`Billing checkout: ${(err as Error).message}`);
    return Response.json({ ok: false, error: "Couldn't start checkout." }, { status: 502 });
  }
}
