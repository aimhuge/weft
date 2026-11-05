import { accountClient } from "./account";

// Telling BlastCP to re-read your Weft plan (docs/architecture/billing.md "BlastCP usage"). BlastCP reads the tier your
// plan includes from weft.zip's /api/billing/blastcp and puts your own BlastCP workspace on it; this only nudges it, with
// your Weft access token as the proof (BlastCP's POST /api/weft/plan, aimhuge/blastcp
// docs/architecture/weft-token-exchange.md). Sent on sign-in and twice a day (lib/blastcp-auto.ts), and whenever the
// billing row sees a different plan, as right after Checkout. Best effort: a failure waits for the next nudge.

const BLASTCP_PLAN_URL = "https://blastcp.com/api/weft/plan";

export async function syncBlastcpPlan(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let token: string | null = null;
  try {
    token = (await accountClient().auth.getSession()).data.session?.access_token ?? null;
  } catch {
    return null;
  }
  if (!token) return null;
  try {
    const res = await fetchImpl(BLASTCP_PLAN_URL, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => ({}))) as { outcome?: string };
    return res.ok ? (body.outcome ?? null) : null;
  } catch (err) {
    console.warn(`BlastCP plan: ${(err as Error).message}`);
    return null;
  }
}

const g = globalThis as { __weftLastPlan?: string };

// The billing row's plan id; a change from the last one this process saw nudges BlastCP. The first sighting doesn't:
// sign-in has already sent one.
export function notePlan(plan: string | null | undefined, sync: () => Promise<unknown> = syncBlastcpPlan): void {
  if (!plan) return;
  const before = g.__weftLastPlan;
  g.__weftLastPlan = plan;
  if (before !== undefined && before !== plan) void sync();
}
