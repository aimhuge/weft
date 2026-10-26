import { after } from "next/server";
import { SUPABASE_URL } from "@/lib/account";
import { billingService } from "@/lib/billing/billing";
import { pukuMeter } from "@/lib/billing/puku-meter";
import { apiError, proxy, restUsageStore, DAILY_REQUESTS, DAILY_TOKENS, GLOBAL_DAILY_REQUESTS, GLOBAL_DAILY_TOKENS, type ProxyConfig } from "@/lib/puku-proxy";

// The Puku trial's proxy to Puku's gateway, on the deployed Weft (Vercel) (lib/puku-proxy.ts,
// docs/architecture/puku-trial.md). puku-cli reaches it as PUKU_AI_BASE_URL=…/api/puku, so it has no localhost
// guard: the signed trial token is the check. The key, the signing secret and SUPABASE_SECRET_KEY are set on the
// deployment only; a Weft without them says so. Replies stream for as long as a model takes to answer.

export const maxDuration = 300;

const limit = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

async function handler(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const apiKey = process.env.PUKU_TRIAL_API_KEY;
  const secret = process.env.PUKU_TRIAL_SIGNING_SECRET;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  if (!apiKey || !secret || !supabaseKey) return apiError(503, "api_error", "The Puku trial isn't set up on this Weft.");
  const { path } = await params;
  // When billing is wired up on the deployed Weft, attach the per-user plan meter so Pro workspaces skip the
  // daily trial cap and spend from their monthly allowance instead. A Weft without billing falls back to
  // today's exact behaviour (the free daily cap).
  const service = billingService();
  const config: ProxyConfig = {
    apiKey,
    secret,
    store: restUsageStore(SUPABASE_URL, supabaseKey),
    dailyRequests: limit("PUKU_TRIAL_DAILY_REQUESTS", DAILY_REQUESTS),
    dailyTokens: limit("PUKU_TRIAL_DAILY_TOKENS", DAILY_TOKENS),
    globalDailyRequests: limit("PUKU_TRIAL_GLOBAL_DAILY_REQUESTS", GLOBAL_DAILY_REQUESTS),
    globalDailyTokens: limit("PUKU_TRIAL_GLOBAL_DAILY_TOKENS", GLOBAL_DAILY_TOKENS),
    // A client that hangs up mid-reply still gets its usage written: after() keeps the function alive for it.
    background: after,
    deadlineMs: (maxDuration - 15) * 1000,
    ...(service ? { plan: pukuMeter(service) } : {}),
  };
  try {
    return await proxy(req, path.join("/"), config);
  } catch (err) {
    console.error(`Puku trial proxy: ${(err as Error).message}`);
    return apiError(502, "api_error", "Weft's Puku trial couldn't handle that request.");
  }
}

export { handler as GET, handler as POST };