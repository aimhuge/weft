import { folderName } from "./format";
import type { GrowthEvent, GrowthOverview } from "./growth-read";
import type { Column } from "./types";

// What Weft says in Slack (docs/architecture/slack.md), as Block Kit plus the plain `text` Slack shows in
// notifications. Pure: lib/slack.ts decides when, and main posts it with the bot token.

export interface SlackText {
  text: string;
  blocks: unknown[];
}

export interface GitCommit {
  sha: string;
  subject: string;
}

export interface DeployInfo {
  project: string;
  state: string;
  target: string | null;
  url: string | null;
  page: string | null;
}

export interface CardUpdate {
  title: string;
  cwd: string;
  column: Column;
  stage?: string;
  remaining?: string;
  // The card's latest reply, trimmed by previewOf.
  preview: string;
  // The card on weft.zip, when its folder syncs.
  link: string | null;
}

// A preview stays well under Block Kit's 3,000-character section limit, and short enough to read in a thread.
export const PREVIEW_MAX = 900;
// More commits than this in one go are counted, not listed.
export const COMMITS_SHOWN = 8;

const COLUMN_LABEL: Record<Column, string> = {
  backlog: "📥 Backlog",
  running: "🏃 Running",
  needs_you: "🙋 Needs you",
  review: "👀 Ready for review",
  done: "✅ Done",
};

// Slack reads &, < and > as markup; everything else in user text goes through as is.
export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A link's label ends at its first `|` and Slack has no escape for one, so a title's own `|` becomes a lookalike.
const label = (text: string) => escape(text).replace(/\|/g, "∣");
const link = (url: string, text: string) => `<${url}|${label(text)}>`;
const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text } });
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

// The latest reply without its BOARD STATUS line, review tour or code fences, cut at a word near PREVIEW_MAX.
export function previewOf(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^BOARD STATUS:.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (plain.length <= PREVIEW_MAX) return plain;
  const cut = plain.slice(0, PREVIEW_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), PREVIEW_MAX - 40))}…`;
}

const quote = (text: string) =>
  escape(text)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

export function commitsMessage(cwd: string, branch: string, commits: GitCommit[]): SlackText {
  const project = folderName(cwd);
  const head = `📝 *${escape(project)}* · ${commits.length === 1 ? "1 commit" : `${String(commits.length)} commits`} on \`${escape(branch)}\``;
  const shown = commits.slice(-COMMITS_SHOWN).map((c) => `\`${c.sha.slice(0, 7)}\` ${escape(c.subject)}`);
  const more = commits.length > COMMITS_SHOWN ? [`_and ${String(commits.length - COMMITS_SHOWN)} more_`] : [];
  return { text: escape(`${project}: ${commits.at(-1)?.subject ?? "commit"}`), blocks: [section([head, ...shown, ...more].join("\n"))] };
}

export function pushMessage(cwd: string, remoteRef: string, count: number): SlackText {
  const project = folderName(cwd);
  const what = count === 1 ? "1 commit" : `${String(count)} commits`;
  return { text: escape(`${project}: pushed ${what} to ${remoteRef}`), blocks: [section(`⬆️ *${escape(project)}* · pushed ${what} to \`${escape(remoteRef)}\``)] };
}

export function deployMessage(d: DeployInfo): SlackText {
  const ok = d.state === "READY";
  const where = d.target === "production" ? "production" : "a preview";
  const head = ok ? `🚀 *${escape(d.project)}* deployed to ${where}` : `❌ *${escape(d.project)}* deploy failed (${escape(d.state.toLowerCase())})`;
  const links = [d.url && link(d.url.startsWith("http") ? d.url : `https://${d.url}`, "open"), d.page && link(d.page, ok ? "on Vercel" : "build logs")].filter(Boolean);
  const text = links.length ? `${head} · ${links.join(" · ")}` : head;
  return { text: escape(`${d.project}: ${ok ? "deployed" : "deploy failed"}`), blocks: [section(text)] };
}

// The first message of a card's Slack thread; its updates reply under it.
export function cardRootMessage(title: string, cwd: string, link: string | null, by?: string): SlackText {
  const name = link ? `<${link}|${label(title)}>` : `*${escape(title)}*`;
  const who = by ? ` · started by <@${by}>` : "";
  return { text: escape(`Weft card: ${title}`), blocks: [section(`🧵 ${name}`), context(`${escape(folderName(cwd))}${who}${link ? "" : " · turn on sync to open it on weft.zip"}`)] };
}

export function cardUpdateMessage(u: CardUpdate): SlackText {
  const status = [u.stage, u.remaining && u.remaining !== "none" ? `left: ${u.remaining}` : ""].filter(Boolean).join(" · ");
  const head = `*${COLUMN_LABEL[u.column]}*${status ? ` · ${escape(status)}` : ""}`;
  const blocks: unknown[] = [section(head)];
  if (u.preview) blocks.push(section(quote(u.preview)));
  if (u.link) blocks.push(context(`${link(u.link, "Open the card on weft.zip")} to reply, review or move it`));
  return { text: escape(`${u.title}: ${COLUMN_LABEL[u.column]}`), blocks };
}

// A short answer in Slack when Weft can't do what was asked.
export function noticeMessage(text: string): SlackText {
  return { text: escape(text), blocks: [section(escape(text))] };
}

// The drawer's "Send a test message".
export function testMessage(): SlackText {
  return {
    text: "Weft is connected",
    blocks: [section("👋 *Weft is connected.* Commits, pushes, deploys and card updates land here; `/weft <what to build>` starts a card.")],
  };
}

// ── Growth ────────────────────────────────────────────────────────────────────────────────────────────────
//
// The growth channel: a new user, a new team, a payment (docs/architecture/slack.md). One message per event,
// so a channel reads as a log rather than a digest — and a digest of one thing is the same thing.

// What a person's address is called in a Slack message: the local part, so it doesn't shout the whole address.
function address(email: string | null): string {
  if (!email) return "someone";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export function newUserMessage(event: GrowthEvent & { kind: "user" }): SlackText {
  const who = address(event.email);
  const head = `👤 *New user* · ${escape(who)}`;
  const text = escape(`New user: ${who}`);
  return { text, blocks: [section(head)] };
}

export function newTeamMessage(event: GrowthEvent & { kind: "team" }): SlackText {
  const head = `👥 *New team* · ${escape(event.name)} · ${String(event.members)} members`;
  const text = escape(`New team: ${event.name} (${String(event.members)} members)`);
  return { text, blocks: [section(head)] };
}

export function paymentMessage(event: GrowthEvent & { kind: "payment" }): SlackText {
  const money = moneyOf(event.amount_cents, event.currency);
  const what = PAYMENT_LABELS[event.event] ?? event.event;
  const plan = event.plan ? ` · ${escape(event.plan)}` : "";
  const seats = event.seats && event.seats > 1 ? ` · ${String(event.seats)} seats` : "";
  const head = `💳 *${escape(what)}* · ${escape(event.org)}${plan}${seats}${money ? ` · ${escape(money)}` : ""}`;
  const text = escape(`${what}: ${event.org}${money ? ` ${money}` : ""}`);
  return { text, blocks: [section(head)] };
}

// What the billing event means, in plain words.
const PAYMENT_LABELS: Record<string, string> = {
  "invoice.paid": "Payment received",
  "subscription.created": "New subscription",
  "subscription.canceled": "Subscription canceled",
  "subscription.resumed": "Subscription resumed",
};

// Cents as money: $20.00, or $20 when the cents are zero.
function moneyOf(cents: number | null, currency: string | null): string | null {
  if (cents === null) return null;
  const symbol = currency === "usd" ? "$" : currency ? `${currency.toUpperCase()} ` : "";
  return `${symbol}${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

// The message for a growth event, whichever kind it is.
export function growthMessage(event: GrowthEvent): SlackText {
  if (event.kind === "user") return newUserMessage(event);
  if (event.kind === "team") return newTeamMessage(event);
  return paymentMessage(event);
}

// The daily summary: the headline numbers and the growth dashboard's address.
export function growthSummaryMessage(overview: GrowthOverview, dashboardUrl: string): SlackText {
  const lines = [
    `📈 *Growth* · ${String(overview.new_7d)} new in 7 days · ${String(overview.new_30d)} in 30`,
    `👤 ${String(overview.accounts)} accounts · ${String(overview.signed_in_7d)} signed in this week`,
    `👥 ${String(overview.workspaces)} workspaces · ${String(overview.paying_workspaces)} paying`,
    `🗂️ ${String(overview.syncing_accounts)} syncing · ${String(overview.synced_cards)} cards synced`,
  ];
  const blocks: unknown[] = [section(lines.join("\n"))];
  if (dashboardUrl) blocks.push(context(link(dashboardUrl, "Open the growth dashboard")));
  return { text: escape(`Growth: ${String(overview.new_7d)} new in 7 days`), blocks };
}
