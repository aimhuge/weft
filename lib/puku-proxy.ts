import { FREE_TIER } from "./billing/plans";
import { count, metered, NO_RESERVE, NO_USAGE, reserve, type MeterHooks, type Reserve, type Usage } from "./puku-proxy-usage";
import { verifyTrialToken } from "./puku-trial-token";

export { mergeUsage, usageIn, type Usage } from "./puku-proxy-usage";

// The Puku trial's proxy (docs/architecture/puku-trial.md), served by the deployed Weft on Vercel at
// /api/puku/v1/* (app/api/puku/v1/[...path]/route.ts). A puku thread with no Puku login of its own sends its
// trial token as the API key; the proxy checks the token's signature, counts the request against the user's daily
// cap (setting aside what it could cost first), swaps in Weft's own Puku key and passes the request to Puku's gateway, streaming the reply back untouched
// while it reads the tokens used from it.

export const UPSTREAM = "https://api-cli.puku.sh";
// The free tier's daily cap (lib/billing/plans.ts FREE_TIER).
export const DAILY_REQUESTS = FREE_TIER.dailyRequests;
export const DAILY_TOKENS = FREE_TIER.dailyTokens;

export interface UsageStore {
  // Adds to the user's row for the day and returns the totals after it.
  add: (userId: string, day: string, usage: Usage) => Promise<Usage>;
}

// The workspace paying for a user's Puku use and what's left of its allowance this period. `check` returning
// null is "no Pro allowance" — the proxy keeps the Free daily cap on for this user. A free or unpaid plan
// returns null, a Pro plan with tokens left returns its remaining count, and an over-limit Pro plan returns
// remaining 0.
export interface PlanMeter {
  // The workspace paying for this user's Puku use and what's left of its allowance this period, or null when the user's plan has none (the daily trial cap applies).
  check(userId: string): Promise<{ orgId: string; remaining: number } | null>;
  record(orgId: string, userId: string, tokens: number): Promise<void>;
}

export interface ProxyConfig {
  apiKey: string;
  secret: string;
  store: UsageStore;
  upstream?: string;
  dailyRequests?: number;
  dailyTokens?: number;
  now?: () => number;
  // When set, the proxy first asks the meter whether the user's workspace still has Puku tokens this period;
  // when the meter says yes, the daily cap is skipped (the day counter still updates) and tokens are billed
  // to the workspace at the end of the request.
  plan?: PlanMeter;
  // Keeps the server alive until a reply's usage is written, even after the client hangs up (the route passes after()).
  background?: MeterHooks["background"];
  // How long a reply may run before it's charged as cut short: a little under the route's maxDuration.
  deadlineMs?: number;
}

// Only what puku-cli calls: messages (and counting their tokens) and the model list.
const PATHS = /^(messages|messages\/count_tokens|models(\/[\w.-]+)?)$/;
// Request headers that describe the hop to Vercel, or carry the trial token, not the request itself.
const DROP_REQUEST = /^(host|connection|content-length|accept-encoding|cookie|authorization|x-api-key|forwarded|x-forwarded-.*|x-real-ip|x-vercel-.*|x-middleware-.*)$/i;
// fetch has already undone the gateway's compression and framing.
const DROP_RESPONSE = /^(content-encoding|content-length|transfer-encoding|connection)$/i;

export const today = (now: number) => new Date(now).toISOString().slice(0, 10);

// An error in the Messages API's own shape, so puku-cli shows its message as it would one from Anthropic.
export function apiError(status: number, type: string, message: string) {
  return Response.json({ type: "error", error: { type, message } }, { status });
}

export function trialToken(req: Request): string {
  const key = req.headers.get("x-api-key")?.trim();
  if (key) return key;
  return /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
}

export function overCap(usage: Usage, dailyRequests: number, dailyTokens: number) {
  return usage.requests > dailyRequests || usage.input_tokens + usage.output_tokens >= dailyTokens;
}

function forwardHeaders(req: Request, apiKey: string) {
  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!DROP_REQUEST.test(name)) headers.set(name, value);
  });
  // puku-cli sends its key both ways; api-cli.puku.sh's /v1/messages answers `multiple_credentials`
  // when it gets both, so the proxy forwards only x-api-key (Anthropic's header for /v1/messages).
  headers.set("x-api-key", apiKey);
  return headers;
}

type Paid = { orgId: string; remaining: number } | null;
interface Admitted {
  userId: string;
  paid: Paid;
  // What the request could cost (zero off the messages path), and the part of it already in the day's row.
  cost: Reserve;
  held: Reserve;
}

const unheld = (held: Reserve, usage: Usage = NO_USAGE): Usage => ({ ...usage, input_tokens: usage.input_tokens - held.input, output_tokens: usage.output_tokens - held.output });

// Pro workspaces bypass the daily cap. A billing outage must not block anyone, so a thrown check falls back to
// the Free path.
async function planCheck(config: ProxyConfig, userId: string): Promise<Paid> {
  if (!config.plan) return null;
  try {
    return await config.plan.check(userId);
  } catch (err) {
    console.error(`Puku trial: plan meter check failed: ${(err as Error).message}`);
    return null;
  }
}

// The trial user a request is for, or the error to answer it with: a bad method or path, a bad token, a request
// asking for too much, or a user whose cap or allowance can't cover what it could cost. On the Free path that cost
// goes into the day's row before the request goes out, in one atomic add, so requests sent at once can't each
// see the same room under the cap; the reply's real usage settles it.
async function admit(req: Request, path: string, body: ArrayBuffer | undefined, config: ProxyConfig, day: string, now: number): Promise<Admitted | Response> {
  if (req.method !== "POST" && req.method !== "GET") return apiError(405, "invalid_request_error", "POST or GET only.");
  if (!PATHS.test(path)) return apiError(404, "not_found_error", `Weft's Puku trial doesn't serve /v1/${path}.`);
  const claims = await verifyTrialToken(trialToken(req), config.secret, now);
  if (!claims) return apiError(401, "authentication_error", "Weft's Puku trial token is missing or expired. Weft gets a new one while you're signed in to your Weft account.");
  if (!path.startsWith("messages")) return { userId: claims.sub, paid: null, cost: NO_RESERVE, held: NO_RESERVE };
  // Counting tokens costs nothing upstream, so only a real messages request sets anything aside.
  const cost = path === "messages" ? reserve(body) : NO_RESERVE;
  if ("refused" in cost) return apiError(400, "invalid_request_error", cost.refused);
  const paid = await planCheck(config, claims.sub);
  const refusal = await hold(config, claims.sub, day, cost, paid);
  return refusal ?? { userId: claims.sub, paid, cost, held: paid ? NO_RESERVE : cost };
}

// Counts the request in the day's row, with what it could cost on the Free path, or answers 429 when the user's
// plan can't cover that cost (a refused request's hold comes straight back).
async function hold(config: ProxyConfig, userId: string, day: string, cost: Reserve, paid: Paid): Promise<Response | undefined> {
  if (paid && paid.remaining < Math.max(1, cost.input + cost.output)) {
    const why = paid.remaining > 0 ? "doesn't have enough left for this request" : "is used up";
    return apiError(429, "rate_limit_error", `This month's Weft Pro Puku allowance ${why}. It resets at the start of your next billing period.`);
  }
  const held = paid ? NO_RESERVE : cost;
  const used = await config.store.add(userId, day, { ...NO_USAGE, requests: 1, input_tokens: held.input, output_tokens: held.output });
  if (paid || !overCap(used, config.dailyRequests ?? DAILY_REQUESTS, config.dailyTokens ?? DAILY_TOKENS)) return undefined;
  if (held.input || held.output) await config.store.add(userId, day, unheld(held));
  return apiError(429, "rate_limit_error", "You've used today's free Puku trial in Weft. Log in to Puku (puku-cli auth login, or Settings → CLIs in Weft) to keep going, or try again tomorrow.");
}

async function forward(req: Request, path: string, body: ArrayBuffer | undefined, config: ProxyConfig): Promise<Response> {
  try {
    return await fetch(`${config.upstream ?? UPSTREAM}/v1/${path}${new URL(req.url).search}`, {
      method: req.method,
      headers: forwardHeaders(req, config.apiKey),
      body,
      // A client that hangs up (puku-cli's Stop) stops the model too; the meter still charges what it wrote.
      signal: req.signal,
    });
  } catch (err) {
    return apiError(502, "api_error", `Couldn't reach Puku: ${(err as Error).message}`);
  }
}

// What a reply cut short is charged: its input is the estimate when message_start never came, and a JSON reply
// (whole before its first byte) its full max_tokens. A streamed one already counts the text it wrote.
function cutShort(usage: Usage, cost: Reserve, streaming: boolean): Usage {
  return { ...usage, input_tokens: usage.input_tokens || cost.input, output_tokens: streaming ? usage.output_tokens : usage.output_tokens || cost.output };
}

// Settles a request once its reply ends: the day's row trades what was held for what was spent (per-day stats stay
// accurate, and a failed reply gives the hold back), and a Pro workspace is charged against its monthly allowance.
// Cache reads don't count, matching overCap.
async function settle(config: ProxyConfig, day: string, { userId, paid, held }: Admitted, spent: Usage) {
  const change = unheld(held, spent);
  if (change.input_tokens || change.cache_read_tokens || change.output_tokens) await config.store.add(userId, day, change);
  const tokens = spent.input_tokens + spent.output_tokens;
  if (!paid || !config.plan || tokens <= 0) return;
  try {
    await config.plan.record(paid.orgId, userId, tokens);
  } catch (err) {
    console.error(`Puku trial: plan meter record failed: ${(err as Error).message}`);
  }
}

export async function proxy(req: Request, path: string, config: ProxyConfig): Promise<Response> {
  const now = (config.now ?? Date.now)();
  const day = today(now);
  const body = req.method === "POST" ? await req.arrayBuffer() : undefined;
  const admitted = await admit(req, path, body, config, day, now);
  if (admitted instanceof Response) return admitted;

  const upstream = await forward(req, path, body, config);
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE.test(name)) headers.set(name, value);
  });
  if (!path.startsWith("messages")) return new Response(upstream.body, { status: upstream.status, headers });
  if (!upstream.ok || !upstream.body) {
    await settle(config, day, admitted, NO_USAGE);
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  const streaming = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
  const done = (usage: Usage, clean: boolean) => settle(config, day, admitted, clean ? usage : cutShort(usage, admitted.cost, streaming));
  return new Response(metered(upstream.body, streaming, done, { signal: req.signal, background: config.background, deadlineMs: config.deadlineMs }), { status: upstream.status, headers });
}

// The usage table through Supabase's REST API with a secret key (it skips row-level security; only the deployed
// Weft holds one). One call to puku_trial_add both adds and returns the day's totals, so two requests at once
// can't both slip under the cap. A new-style sb_secret_ key goes in apikey alone; a legacy JWT also as the bearer.
export function restUsageStore(url: string, key: string): UsageStore {
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (!key.startsWith("sb_")) headers.authorization = `Bearer ${key}`;
  return {
    add: async (userId, day, usage) => {
      const res = await fetch(`${url}/rest/v1/rpc/puku_trial_add`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          p_user: userId,
          p_day: day,
          p_requests: usage.requests,
          p_input: usage.input_tokens,
          p_cache_read: usage.cache_read_tokens,
          p_output: usage.output_tokens,
        }),
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      const row = (await res.json()) as Partial<Usage>;
      return {
        requests: count(row.requests),
        input_tokens: count(row.input_tokens),
        cache_read_tokens: count(row.cache_read_tokens),
        output_tokens: count(row.output_tokens),
      };
    },
  };
}
