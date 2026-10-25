import { execFile } from "node:child_process";
import fs from "node:fs";
import { basename, join } from "node:path";
import { accountView } from "./account";
import { seedChipLines } from "./project-seed-run";
import { analyticsTools, dependencies, GTAG_ONLY, statusOf, within, type Source } from "./copilot-sources";
import { shell } from "./browser-tools";
import { DATA_DIR } from "./store";
import { driftGaps, type VercelDrift } from "./vercel-drift";

// What isn't set up yet, per project: the Weft account, the GitHub CLI's sign-in, Vercel, Supabase, Cloudflare and analytics.
// The copilot's chips offer one "link it" chip from these (lib/copilot-suggest.ts), and its setup_status tool reads them to
// walk you through onboarding (lib/board-tools.ts). Each check says only what is missing, why it helps, and where to link it.
// A linked project whose 🔐 vault and Vercel env have drifted apart is one too (lib/vercel-drift.ts, names only).

export type Gap = { project?: string; what: string; why: string; where: string };

type Folder = { folder: string; link?: unknown };
type Status = { signedIn?: boolean; folders?: Folder[] };

const has = (root: string, ...names: string[]) => names.some((n) => fs.existsSync(join(root, n)));
const WEB = ["next", "react", "vue", "svelte", "@sveltejs/kit", "nuxt", "astro", "vite", "@remix-run/react", "solid-js"];

const ghSignedIn = () =>
  new Promise<boolean>((resolve) => execFile("gh", ["auth", "status"], { timeout: 5_000 }, (err) => resolve(!err)));

const linked = (s: Status, root: string) => Boolean(s.folders?.find((f) => f.folder === root)?.link);

type Ctx = { vercel: Status | null; supabase: Status | null; cloudflareLinks: Record<string, unknown>; cloudflareToken: boolean };

// The gaps across these projects, account-wide ones first. A service that can't be asked is left out, not reported missing.
export async function setupGaps(projects: readonly string[], deps = { ghSignedIn, accountView }): Promise<Gap[]> {
  const [account, gh, vercel, supabase, drifts] = await Promise.all([
    deps.accountView().catch(() => null),
    deps.ghSignedIn(),
    (statusOf("/vercel/status", projects) as Promise<Status>).catch(() => null),
    (statusOf("/supabase/status", projects) as Promise<Status>).catch(() => null),
    // Main's cached lists only: never waits on Vercel (electron/vercel-env-cache.cjs).
    Promise.resolve()
      .then(() => shell("/vercel/env-drift", { folders: projects }) as Promise<unknown> as Promise<VercelDrift[] | null>)
      .catch(() => null),
  ]);
  const gaps: Gap[] = [];
  if (account?.configured && !account.user)
    gaps.push({ what: "Weft account", why: "your board on weft.zip, teams, and webhook relays", where: "Sign in, in the top bar" });
  if (!gh) gaps.push({ what: "GitHub CLI sign-in", why: "open PRs and issues, issue sync", where: "the GitHub drawer on the left rail, or `gh auth login` in the terminal (⌃`)" });
  if (vercel && !vercel.signedIn && projects.some((p) => isWeb(p)))
    gaps.push({ what: "Vercel token", why: "deploy status, env pushes from the vault", where: "the ▲ Vercel drawer on the left rail" });
  const ctx: Ctx = { vercel, supabase, cloudflareLinks: readCloudflareLinks(), cloudflareToken: fs.existsSync(join(DATA_DIR, "cloudflare-token.json")) };
  for (const root of projects) gaps.push(...projectGaps(root, ctx));
  for (const { folder, ...g } of driftGaps(Array.isArray(drifts) ? drifts : [])) gaps.push({ project: basename(folder), ...g });
  return gaps;
}

// One project's gaps: its Vercel link, Supabase, Cloudflare and analytics.
function projectGaps(root: string, ctx: Ctx): Gap[] {
  const project = basename(root);
  return [vercelGap(root, ctx.vercel), supabaseGap(root, ctx.supabase), cloudflareGap(root, ctx), analyticsGap(root)]
    .filter((g): g is Omit<Gap, "project"> => g !== null)
    .map((g) => ({ project, ...g }));
}

type ProjectGap = Omit<Gap, "project"> | null;

function vercelGap(root: string, vercel: Status | null): ProjectGap {
  if (!vercel?.signedIn || !isWeb(root) || linked(vercel, root)) return null;
  return { what: "Vercel project link", why: "see its deploys and push env vars", where: "the ▲ Vercel drawer → Link" };
}

function supabaseGap(root: string, supabase: Status | null): ProjectGap {
  const uses = has(root, "supabase") || Object.keys(dependencies(root) ?? {}).some((d) => d.startsWith("@supabase/"));
  if (!supabase || !uses || (supabase.signedIn && linked(supabase, root))) return null;
  return { what: supabase.signedIn ? "Supabase project link" : "Supabase token", why: "unapplied migrations and project health", where: "the Supabase bolt on the left rail" };
}

function cloudflareGap(root: string, { cloudflareLinks, cloudflareToken }: Ctx): ProjectGap {
  if (!has(root, "wrangler.toml", "wrangler.json", "wrangler.jsonc") || (cloudflareToken && root in cloudflareLinks)) return null;
  return { what: cloudflareToken ? "Cloudflare Worker link" : "Cloudflare token", why: "deploys of its Worker or Pages project", where: "the orange cloud on the left rail" };
}

function analyticsGap(root: string): ProjectGap {
  const tools = isWeb(root) ? analyticsTools(root) : null;
  if (tools && !tools.length)
    return { what: "analytics", why: "answers to how many users you got and what a feature changed", where: "a thread in the project that adds PostHog or GA4" };
  if (tools?.length && tools.every((t) => t === GTAG_ONLY))
    return { what: "GA4 Data API access", why: "user numbers, not just page tags", where: "a thread that adds a GA4 service account key to the 🔐 vault and reads it" };
  return null;
}

function isWeb(root: string) {
  const deps = dependencies(root);
  return Boolean(deps && WEB.some((d) => d in deps));
}

function readCloudflareLinks(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(join(DATA_DIR, "cloudflare-links.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const gapLine = (g: Gap) => `- ${g.project ? `${g.project}: ` : ""}${g.what} not set up (gives ${g.why}); link it at ${g.where}`;

// The chips' setup section.
export const setup: Source = async (projects) => (await setupGaps(projects)).map(gapLine);

export const SETUP_SOURCE = { title: "Not set up yet", source: setup, ms: 6_000 };

// The starter cards a project's Backlog would get now (lib/project-seed-run.ts), for chips that offer them.
export const SEED_SOURCE = { title: "Starter work Weft found", source: ((projects) => seedChipLines(projects)) as Source, ms: 6_000 };

// The copilot's setup_status tool: every gap, or that everything Weft can link is linked.
export async function setupReport(projects: readonly string[]): Promise<string> {
  const lines = await within(8_000, () => setup(projects, []));
  return lines.length ? lines.join("\n") : "Everything Weft can link for these projects is linked.";
}
