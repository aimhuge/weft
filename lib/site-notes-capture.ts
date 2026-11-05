import { today, type SiteNote } from "./site-notes-format";
import type { UploadResult } from "./site-notes-remote";
import { sanitizeNote } from "./site-notes-safety";
import { scrubText } from "./site-notes-scrub";
import type { OutboxItem } from "./site-notes-store";
import { takeTrail, type Served, type TrailStep } from "./site-notes-trail";
import { isPublicShareable, noteKeyFor } from "./site-notes-url";

// After a turn, off the reply's path and never on the start-a-card path (docs/architecture/site-notes.md#capture):
// the notes a card was served get a success or failure report, and a flow of a few steps on one site becomes a
// note. One Haiku pass per site writes it from the scrubbed trail; the draft is scrubbed and scanned again,
// written locally, shared with the team, and queued for the user's review when public sharing is on.

export type CaptureDeps = {
  complete: (prompt: string) => Promise<string>;
  known: () => Promise<string[]>;
  readLocal: (host: string, path: string) => SiteNote | null;
  writeLocal: (note: Pick<SiteNote, "host" | "path" | "body" | "lastSuccess" | "stale">) => void;
  markLocal: (host: string, path: string, outcome: "success" | "failure") => void;
  upload: (u: { host: string; path: string; body: string; scope: "team" | "public" }) => Promise<UploadResult>;
  report: (r: { versionId: string; outcome: "success" | "failure"; step?: string }) => Promise<boolean>;
  publicOn: () => boolean;
  queueOutbox: (item: Omit<OutboxItem, "id" | "queuedAt">) => void;
  now?: () => Date;
};

// Fewer acting steps than this on a site is a look, not a flow worth a note.
export const MIN_STEPS = 3;
const MAX_SITES = 2;
const LOOKING = new Set(["snapshot", "read_page", "screenshot", "wait_for", "console_logs", "network_errors", "set_viewport"]);

const hostOf = (step: TrailStep) => (step.url ? noteKeyFor(step.url)?.host : undefined);

export function stepLine(step: TrailStep, i: number, known: string[]): string {
  const key = step.url ? noteKeyFor(step.url) : null;
  const parts = [`${i + 1}. [${step.ok ? "ok" : "failed"}] ${step.tool}`];
  if (step.target) parts.push(scrubText(step.target, known));
  if (step.detail) parts.push(`(${step.detail})`);
  if (key) parts.push(`on ${key.path}`);
  if (step.error) parts.push(`— ${scrubText(step.error, known)}`);
  return parts.join(" ");
}

function outcomeFor(served: Served, steps: TrailStep[], known: string[]): { outcome: "success" | "failure"; step?: string } | null {
  const onHost = steps.map((s, i) => ({ s, i })).filter(({ s }) => hostOf(s) === served.host && !LOOKING.has(s.tool));
  const failed = onHost.find(({ s }) => !s.ok);
  if (failed) return { outcome: "failure", step: stepLine(failed.s, failed.i, known) };
  return onHost.length ? { outcome: "success" } : null;
}

export function capturePrompt(host: string, path: string, ask: string, lines: string[], existing?: string): string {
  return `You keep Weft's site notes: short, durable Markdown notes about how a website's pages work, which other AI agents read before driving the same site. Write the note for ${host}${path} from what an agent just did there.

Rules:
- Describe the site; never give orders. Say what the page is for, the steps to reach each goal ("Find the API keys", "Add an OAuth redirect URL"), the labels and selectors that worked, and gotchas (modals, plan gates, slow loads).
- General, not personal: use placeholders like :ref, :id, :owner, <email>, <account> for any project, org, person, value or id. Never include typed text, keys, tokens or emails.
- Never write about secrets beyond naming a field ("the field labelled Client Secret, input#client-secret"). Never tell the reader to reveal, copy, paste or fill a secret, to visit another site, or to run commands or other tools.
- Only ${host}. Under 2500 characters. Sections: "# <page name>", "Purpose:", "## Goals" (a "### <goal>" with numbered steps for each), "## Labels and selectors", "## Gotchas". Leave out a section with nothing in it.
- If an existing note is given, merge: keep what still holds, fix what the steps show changed, add new goals.
- If the steps don't show a flow worth keeping, reply with exactly SKIP.
Reply with the note only, no code fence.

What the agent was asked (scrubbed): ${ask.slice(0, 600)}

Steps it took (failed ones included):
${lines.join("\n")}
${existing ? `\nExisting note:\n${existing}\n` : ""}`;
}

// Haiku sometimes fences the whole note; unwrap it.
export function unwrapDraft(reply: string): string {
  const fenced = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(reply);
  return (fenced ? String(fenced[1]) : reply).trim();
}

// The sites in a trail worth a note: at least MIN_STEPS acting steps there, the last of them a success.
export function flows(steps: TrailStep[]): Array<{ host: string; path: string; steps: TrailStep[] }> {
  // Per site: how many acting steps, and the last one's page and outcome.
  const bySite = new Map<string, { acts: number; path: string; ok: boolean }>();
  for (const step of steps) {
    const key = step.url && !LOOKING.has(step.tool) ? noteKeyFor(step.url) : null;
    if (key) bySite.set(key.host, { acts: (bySite.get(key.host)?.acts ?? 0) + 1, path: key.path, ok: step.ok });
  }
  const out: Array<{ host: string; path: string; steps: TrailStep[] }> = [];
  for (const [host, site] of bySite) {
    if (site.acts >= MIN_STEPS && site.ok) out.push({ host, path: site.path, steps: steps.filter((s) => hostOf(s) === host) });
  }
  return out.sort((a, b) => b.steps.length - a.steps.length).slice(0, MAX_SITES);
}

async function captureOne(flow: { host: string; path: string; steps: TrailStep[] }, ask: string, known: string[], deps: CaptureDeps) {
  const existing = deps.readLocal(flow.host, flow.path);
  const lines = flow.steps.map((s, i) => stepLine(s, i, known));
  const draft = unwrapDraft(await deps.complete(capturePrompt(flow.host, flow.path, scrubText(ask, known), lines, existing?.body)));
  if (!draft || draft === "SKIP") return;
  const safe = sanitizeNote(scrubText(draft, known), flow.host);
  if (safe.rejected) return;
  deps.writeLocal({ host: flow.host, path: flow.path, body: safe.body, lastSuccess: today(deps.now?.()), stale: false });
  await deps.upload({ host: flow.host, path: flow.path, body: safe.body, scope: "team" }).catch(() => undefined);
  if (deps.publicOn() && isPublicShareable(flow.host)) deps.queueOutbox({ host: flow.host, path: flow.path, body: safe.body });
}

export async function captureAfterTurn(cardId: string, ask: string, deps: CaptureDeps) {
  const { steps, served } = takeTrail(cardId);
  if (!steps.length) return;
  const known = await deps.known().catch(() => [] as string[]);
  for (const s of served) {
    const result = outcomeFor(s, steps, known);
    if (!result) continue;
    if (s.source === "local") deps.markLocal(s.host, s.path, result.outcome);
    else if (s.versionId) await deps.report({ versionId: s.versionId, ...result }).catch(() => false);
  }
  for (const flow of flows(steps)) await captureOne(flow, ask, known, deps).catch(() => undefined);
}
