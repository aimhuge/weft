// Where a feedback summary goes (lib/feedback.ts). On the Mac: forward to the deployed Weft's collector. On the
// deployed Weft: keep it in the `feedback` table and post it to the team's Slack through an incoming webhook.
//
// The webhook's address comes from one of two places: SLACK_FEEDBACK_WEBHOOK_URL in the environment, or the
// `slack_webhooks` table — where the OAuth install (lib/slack-oauth.ts) puts it, so the URL never has to be
// copied out of a console page by hand. The environment wins when both are there.
import { cleanMessages, cleanSummary, type FeedbackMessage, type FeedbackSummary } from "./feedback";
import { SITE } from "./site";
import { readWebhook, FEEDBACK_PURPOSE } from "./slack-webhook-store";
import { serviceClient } from "./web-session";

export const FEEDBACK_COLLECT_URL = `${SITE}/api/feedback/collect`;

export interface FeedbackPayload {
  summary: FeedbackSummary;
  messages: FeedbackMessage[];
  from: { name: string | null; email: string | null } | null;
  version: string | null;
}

// The Mac's side. True when the deployed Weft took it; a failure leaves the copy in ~/.weft/feedback marked unsent.
export async function forwardFeedback(payload: FeedbackPayload, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(FEEDBACK_COLLECT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// The collector's body, checked: a summary is required, the rest is optional and clipped.
export function cleanPayload(body: unknown): FeedbackPayload {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const summary = cleanSummary(raw.summary);
  let messages: FeedbackMessage[] = [];
  try {
    messages = cleanMessages(raw.messages);
  } catch {
    messages = [];
  }
  const from = typeof raw.from === "object" && raw.from !== null ? (raw.from as Record<string, unknown>) : null;
  const who = from ? { name: str(from.name, 120), email: str(from.email, 200) } : null;
  return { summary, messages, from: who?.name || who?.email ? who : null, version: str(raw.version, 40) };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Markdown bullets and bold as Slack's mrkdwn.
function mrkdwn(text: string): string {
  return escape(text)
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/\*\*(.+?)\*\*/g, "*$1*");
}

export function slackText(p: FeedbackPayload): string {
  const name = p.from?.name ? escape(p.from.name) : null;
  const email = p.from?.email ? `<mailto:${escape(p.from.email)}|${escape(p.from.email)}>` : null;
  const who = [name, email].filter(Boolean).join(" ") || "someone signed out";
  const footer = `_From ${who}${p.version ? ` · Weft v${escape(p.version)}` : ""}_`;
  return [`*💬 ${escape(p.summary.title)}*`, mrkdwn(p.summary.body), footer].join("\n");
}

// A Mac can't flood the channel: at most LIMIT summaries per address in WINDOW_MS, per server instance.
export const LIMIT = 5;
export const WINDOW_MS = 10 * 60_000;
const recent = new Map<string, number[]>();

export function allow(key: string, now = Date.now()): boolean {
  const times = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= LIMIT) {
    recent.set(key, times);
    return false;
  }
  recent.set(key, [...times, now]);
  return true;
}

export function resetLimits() {
  recent.clear();
}

interface CollectDeps {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  service?: ReturnType<typeof serviceClient>;
  // The stored webhook, read from the database when the environment doesn't name one. A test passes it in so it
  // doesn't need a database.
  storedWebhook?: string | null;
}

// Keeps it in the `feedback` table; false without the service key or when the insert fails.
async function store(service: ReturnType<typeof serviceClient>, p: FeedbackPayload): Promise<boolean> {
  if (!service) return false;
  const row = { title: p.summary.title, body: p.summary.body, messages: p.messages, from_name: p.from?.name ?? null, from_email: p.from?.email ?? null, version: p.version };
  return !(await service.from("feedback").insert(row)).error;
}

// Posts it to the team's channel; false without the webhook or when Slack doesn't take it.
async function postToSlack(hook: string | null | undefined, p: FeedbackPayload, fetcher: typeof fetch): Promise<boolean> {
  if (!hook) return false;
  try {
    const res = await fetcher(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: slackText(p) }), signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;
  }
}

// The deployed Weft's side. 204 once it's stored or posted, 400 for a bad body, 429 past the limit, 502 when
// the table and Slack both failed, 503 when neither is set up.
export async function collectFeedback(body: unknown, key: string, deps: CollectDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const service = deps.service === undefined ? serviceClient(env) : deps.service;
  let payload: FeedbackPayload;
  try {
    payload = cleanPayload(body);
  } catch {
    return 400;
  }
  if (!allow(key)) return 429;
  // The environment names the webhook; otherwise the OAuth install put it in the database.
  const hook = env.SLACK_FEEDBACK_WEBHOOK_URL || (deps.storedWebhook ?? (await readWebhook(FEEDBACK_PURPOSE, env)));
  const [stored, posted] = await Promise.all([store(service, payload), postToSlack(hook, payload, deps.fetcher ?? fetch)]);
  if (stored || posted) return 204;
  return service || hook ? 502 : 503;
}
