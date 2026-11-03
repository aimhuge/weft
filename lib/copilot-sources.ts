import { execFile } from "node:child_process";
import fs from "node:fs";
import { basename, join } from "node:path";
import { readActivity, withoutHandedOff } from "./activity";
import { shell } from "./browser-tools";
import { readPile, repoRoot } from "./commit-pile";
import { firstLine } from "./format";
import { activeDays, dayKey, streakOf, tallyDays } from "./game";
import { measureQuality } from "./quality";
import { weakest } from "./quality-view";
import { readScout } from "./scout";
import { mapBacklog } from "./sprint-plan";
import { DATA_DIR, getThread, listCards } from "./store";
import { COPILOT_ID, type Card } from "./types";
import { listWebhooks } from "./webhooks";

// What the copilot's chips are made from, tiers 2 and 3 (tier 1, the cards themselves, is lib/copilot-context.ts):
// cached reads Weft already keeps (pile, scout, quality, streak, Backlog, blanks, the copilot's own history) and outside
// data (Vercel, Supabase, GitHub, analytics). Each source has its own timeout and gives no lines when it fails, so one
// slow or signed-out service never holds the chips back.

export type Section = { title: string; lines: string[] };
export type Source = (projects: readonly string[], cards: readonly Card[]) => Promise<string[]> | string[];

const MAX_PROJECTS = 5;
const DAY = 86_400_000;
const CLICKS_FILE = join(DATA_DIR, "copilot-chips.jsonl");
const MAX_CLICKS = 200;

// The projects that matter right now: the repo roots of open cards, busiest first.
export function activeProjects(cards: readonly Card[], rootOf: (cwd: string) => string = safeRoot): string[] {
  const count = new Map<string, number>();
  for (const c of cards) {
    if (c.role === "copilot" || c.archived || c.column === "done") continue;
    const root = rootOf(c.cwd);
    count.set(root, (count.get(root) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1]).slice(0, MAX_PROJECTS).map(([root]) => root);
}

// The project a card's folder belongs to: its repo root, worktrees folded in, as the board's project chips have it.
export function safeRoot(cwd: string) {
  try {
    return repoRoot(cwd) || cwd;
  } catch {
    return cwd;
  }
}

// `work`, or [] once `ms` pass or it throws.
export async function within(ms: number, work: () => Promise<string[]> | string[]): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string[]>((resolve) => (timer = setTimeout(() => resolve([]), ms)));
  try {
    return await Promise.race([Promise.resolve().then(work), timeout]);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const name = (root: string) => basename(root);

// Tier 2: what Weft has already worked out.

export const pile: Source = (projects) =>
  projects.flatMap((root) => {
    const p = readPile(root);
    return p ? [`- ${name(root)}: ${String(p.files.length)} uncommitted files, +${String(p.added)}/-${String(p.removed)}`] : [];
  });

// Quality is measured from the files on disk; keep each project's for half an hour.
const qualityCache = new Map<string, { at: number; text: string }>();
export const quality: Source = (projects) => projects.flatMap((root) => {
  try {
    return projectQuality(root);
  } catch {
    return [];
  }
});

// One project's score, weakest sections and open scout findings; it throws for a folder it can't measure.
function projectQuality(root: string): string[] {
  const lines: string[] = [];
  let q = qualityCache.get(root);
  if (!q || Date.now() - q.at > 30 * 60_000) {
    const report = measureQuality(root);
    const weak = weakest(report).slice(0, 2).map((s) => `${s.name} ${String(s.score)}%`);
    q = { at: Date.now(), text: `- ${name(root)}: code quality ${String(report.score)}%${weak.length ? `, weakest: ${weak.join(", ")}` : ""}` };
    qualityCache.set(root, q);
  }
  lines.push(q.text);
  const scout = readScout(root);
  for (const f of scout?.findings.filter((x) => !scout.started.includes(x.id)).slice(0, 3) ?? [])
    lines.push(`  refactor scout: ${basename(f.file)}${f.line ? `:${String(f.line)}` : ""} ${f.smell}: ${firstLine(f.fix, 100)}`);
  return lines;
}

export const streak: Source = () => {
  const days = tallyDays(withoutHandedOff(readActivity(), listCards()), (cwd) => cwd);
  const now = Date.now();
  const s = streakOf(activeDays(days), dayKey(now));
  const sum = (n: number) => {
    let done = 0, turns = 0;
    for (let i = 0; i < n; i++) {
      const d = days.get(dayKey(now - i * DAY));
      done += d?.done ?? 0;
      turns += d?.turns ?? 0;
    }
    return `${String(done)} cards done, ${String(turns)} turns`;
  };
  const today = days.get(dayKey(now));
  return [
    `- streak ${String(s.current)} days (best ${String(s.best)})${s.atRisk && !today?.done && !today?.turns ? ", nothing yet today" : ""}`,
    `- last 7 days: ${sum(7)}; last 60 days: ${sum(60)}`,
  ];
};

export const backlog: Source = (projects, cards) =>
  projects.flatMap((root) => {
    const m = mapBacklog([...cards], root);
    return m.backlog.length ? [`- ${name(root)}: ${String(m.backlog.length)} in Backlog, ${String(m.active.length)} active`] : [];
  });

export const blanks: Source = async (projects) => {
  const lines: string[] = [];
  for (const root of projects) {
    const r = (await shell("/secrets/list", { folder: root })) as { secrets?: { name: string; missing?: boolean }[] };
    const missing = (r.secrets ?? []).filter((s) => s.missing).map((s) => s.name);
    if (missing.length) lines.push(`- ${name(root)}: vault blanks to fill in: ${missing.slice(0, 5).join(", ")}`);
  }
  for (const w of listWebhooks(projects).filter((h) => !h.registered))
    lines.push(`- ${name(w.folder)}: webhook "${w.name}" (${w.target}) not registered yet${w.hint ? `, at ${w.hint}` : ""}`);
  return lines;
};

// What you've asked the copilot lately and which chips you clicked, so the chips don't repeat and lean your way.
export const history: Source = () => {
  const asked = getThread(COPILOT_ID)
    .filter((i): i is Extract<typeof i, { kind: "user" }> => i.kind === "user")
    .slice(-6)
    .map((i) => `- you asked: ${firstLine(i.text, 100)}`);
  const clicked = readClicks().slice(-8).map((c) => `- you clicked: ${c}`);
  return [...asked, ...clicked];
};

// Tier 3: outside services.

// The control server's /vercel/status or /supabase/status for these folders, shared by the deploy, migration and setup
// lines (lib/copilot-setup.ts) and kept a minute, so one run asks each service once.
const statusCache = new Map<string, { at: number; data: Promise<Record<string, unknown>> }>();
export function statusOf(route: "/vercel/status" | "/supabase/status", projects: readonly string[]) {
  const key = `${route} ${projects.join("|")}`;
  const hit = statusCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;
  const data = shell(route, { folders: projects });
  statusCache.set(key, { at: Date.now(), data });
  void data.catch(() => statusCache.delete(key));
  return data;
}

export const vercel: Source = async (projects) => {
  const r = (await statusOf("/vercel/status", projects)) as {
    folders?: { folder: string; link?: { name?: string | null; latest?: { state: string; createdAt: number } | null } | null }[];
  };
  return (r.folders ?? []).flatMap((f) => {
    const d = f.link?.latest;
    if (!d) return [];
    const hours = Math.round((Date.now() - d.createdAt) / 3_600_000);
    return [`- ${name(f.folder)}: latest Vercel deploy of ${f.link?.name ?? "the project"} is ${d.state}, ${String(hours)}h ago`];
  });
};

export const supabase: Source = async (projects) => {
  const r = (await statusOf("/supabase/status", projects)) as {
    folders?: { folder: string; link?: { name?: string | null; pending?: string[] | null; status?: string } | null }[];
  };
  return (r.folders ?? []).flatMap((f) => {
    const l = f.link;
    if (!l) return [];
    const lines: string[] = [];
    if (l.pending?.length) lines.push(`- ${name(f.folder)}: ${String(l.pending.length)} Supabase migrations not applied (${l.pending.slice(0, 2).join(", ")})`);
    if (l.status && l.status !== "ACTIVE_HEALTHY") lines.push(`- ${name(f.folder)}: Supabase project ${l.name ?? ""} is ${l.status}`);
    return lines;
  });
};

const gh = (args: string[], cwd: string) =>
  new Promise<string>((resolve, reject) =>
    execFile("gh", args, { cwd, timeout: 6_000 }, (err, out) => (err ? reject(new Error(err.message)) : resolve(out))),
  );

// Open PRs and the newest open issues per repo, through your own `gh` sign-in; kept 10 minutes.
const ghCache = new Map<string, { at: number; lines: string[] }>();
export const github: Source = async (projects) => {
  const all = await Promise.all(
    projects.map(async (root) => {
      const hit = ghCache.get(root);
      if (hit && Date.now() - hit.at < 10 * 60_000) return hit.lines;
      const [prs, issues] = await Promise.all([
        gh(["pr", "list", "--state", "open", "--limit", "5", "--json", "number,title,isDraft"], root).catch(() => "[]"),
        gh(["issue", "list", "--state", "open", "--limit", "5", "--json", "number,title"], root).catch(() => "[]"),
      ]);
      const parse = (s: string) => {
        try {
          return JSON.parse(s) as { number: number; title: string; isDraft?: boolean }[];
        } catch {
          return [];
        }
      };
      const lines = [
        ...parse(prs).map((p) => `- ${name(root)}: open PR #${String(p.number)} "${firstLine(p.title, 70)}"${p.isDraft ? " (draft)" : ""}`),
        ...parse(issues).map((i) => `- ${name(root)}: open issue #${String(i.number)} "${firstLine(i.title, 70)}"`),
      ];
      ghCache.set(root, { at: Date.now(), lines });
      return lines;
    }),
  );
  return all.flat();
};

// Which analytics each project ships, from its package.json, so a chip about users can say where the numbers live.
const ANALYTICS: Record<string, string> = {
  "posthog-js": "PostHog", "posthog-node": "PostHog", "@vercel/analytics": "Vercel Analytics", "@google-analytics/data": "GA4 Data API",
  "react-ga4": "GA4", "@next/third-parties": "GA4 (via @next/third-parties)", "mixpanel-browser": "Mixpanel", "@amplitude/analytics-browser": "Amplitude",
  "plausible-tracker": "Plausible", "@segment/analytics-next": "Segment",
};
// A project's package.json dependencies, or null when it has none to read.
export function dependencies(root: string): Record<string, string> | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return null;
  }
}

// What a project with only a gtag in its pages has: page tags, but nothing a server can read numbers from.
export const GTAG_ONLY = "GA4 (gtag in the page, no server API)";

// The analytics a project ships, from its dependencies (and Weft's own gtag component), or null without a package.json.
export function analyticsTools(root: string): string[] | null {
  const deps = dependencies(root);
  if (!deps) return null;
  const tools = [...new Set(Object.keys(deps).flatMap((d) => (ANALYTICS[d] ? [ANALYTICS[d]] : [])))];
  if (!tools.length && fs.existsSync(join(root, "components", "GoogleAnalytics.tsx"))) tools.push(GTAG_ONLY);
  return tools;
}

export const analytics: Source = (projects) =>
  projects.flatMap((root) => {
    const tools = analyticsTools(root);
    return tools ? [`- ${name(root)}: analytics ${tools.length ? tools.join(", ") : "none set up"}`] : [];
  });

export const SOURCES: { title: string; source: Source; ms: number }[] = [
  { title: "Uncommitted work", source: pile, ms: 3_000 },
  { title: "Code quality and refactor scout", source: quality, ms: 4_000 },
  { title: "Your streak and activity", source: streak, ms: 1_000 },
  { title: "Backlog", source: backlog, ms: 1_000 },
  { title: "Vault and webhook blanks", source: blanks, ms: 2_000 },
  { title: "Recent copilot asks and chip clicks", source: history, ms: 1_000 },
  { title: "Vercel deploys", source: vercel, ms: 5_000 },
  { title: "Supabase", source: supabase, ms: 5_000 },
  { title: "GitHub", source: github, ms: 7_000 },
  { title: "Analytics", source: analytics, ms: 1_000 },
];

// Every source at once, each within its own time; sections with nothing to say are left out.
export async function gatherSections(cards: readonly Card[], sources = SOURCES, projects = activeProjects(cards)): Promise<Section[]> {
  if (!projects.length) return [];
  const results = await Promise.all(sources.map((s) => within(s.ms, () => s.source(projects, cards))));
  return sources.map((s, i) => ({ title: s.title, lines: results[i] ?? [] })).filter((s) => s.lines.length);
}

// The chips you clicked, oldest first, kept to the last MAX_CLICKS.
export function readClicks(file = CLICKS_FILE): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { text: string }).text);
  } catch {
    return [];
  }
}

export function recordClick(text: string, file = CLICKS_FILE) {
  const kept = [...readClicks(file), text].slice(-MAX_CLICKS);
  fs.writeFileSync(file, kept.map((t) => JSON.stringify({ text: t, at: Date.now() })).join("\n") + "\n");
}

// Forget the quality and GitHub caches (tests; a fresh start).
export function resetSourceCaches() {
  qualityCache.clear();
  ghCache.clear();
  statusCache.clear();
}
