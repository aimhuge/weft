// What the project intake (lib/project-intake.ts) reads out of a project's code: the env names it reads, which
// become 🔐 blanks, and the webhook routes it serves, which become 🪝 blanks. Pure: text in, names out, so it's
// tested without a project on disk. Regexes, not a parser: a name in a comment counts too, which only costs a
// blank the user can delete (and an intake never offers it again).

const ENV_READS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z_][A-Z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /os\.environ(?:\.get\(|\[)\s*["']([A-Z_][A-Z0-9_]*)["']/g,
  /os\.getenv\(\s*["']([A-Z_][A-Z0-9_]*)["']/g,
  /Deno\.env\.get\(\s*["']([A-Z_][A-Z0-9_]*)["']/g,
];

// Set by the platform or the shell, never something you bring: Node, CI runners, and Vercel's system variables.
const RUNTIME = /^(NODE_ENV|CI|PORT|HOST|HOSTNAME|HOME|PATH|PWD|USER|SHELL|TZ|LANG|DEBUG|TERM|TMPDIR|NEXT_RUNTIME|NEXT_PHASE|VERCEL|VERCEL_(ENV|URL|REGION|BRANCH_URL|PROJECT_PRODUCTION_URL|DEPLOYMENT_ID|TARGET_ENV|GIT_[A-Z_]+)|GITHUB_(ACTIONS|SHA|REF|REF_NAME|RUN_[A-Z_]+|WORKSPACE|EVENT_[A-Z_]+|REPOSITORY|ACTOR|HEAD_REF|BASE_REF|OUTPUT|ENV|STEP_SUMMARY|SERVER_URL)|RUNNER_[A-Z_]+|npm_[A-Za-z_]+)$/;

// Shaped like something a provider hands you. A plain flag (FEATURE_X, LOG_LEVEL) isn't worth a blank.
const SECRET_SHAPED = /(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASSWD|DSN|CREDENTIALS|PAT)(_|$)|^DATABASE_URL$|^POSTGRES_URL|^DIRECT_URL$|^REDIS_URL$/;

// A name the code sets itself (process.env.X = …) is the app's own plumbing, not a value you bring.
const SETS = /process\.env\.([A-Z_][A-Z0-9_]*)\s*=(?!=)/g;

/** Every env name a source file reads, set-by-itself names left out. */
export function envReads(text: string): Set<string> {
  const found = new Set<string>();
  for (const re of ENV_READS) for (const m of text.matchAll(re)) found.add(m[1] ?? "");
  for (const m of text.matchAll(SETS)) found.delete(m[1] ?? "");
  found.delete("");
  return found;
}

// A known provider's URL or id is worth a blank too (NEXT_PUBLIC_SUPABASE_URL, GOOGLE_CLIENT_ID); its other names
// are usually the app's own settings (CLAUDE_CONFIG_DIR, VERCEL_BIN, SLACK_DEV).
const PROVIDER_SHAPED = /(^|_)(URL|URI|ID|HOST)(_|$)/;

/** Whether a read name deserves a 🔐 blank. known: a provider Weft has a hint for. */
export function wantsBlank(name: string, known: boolean): boolean {
  if (RUNTIME.test(name)) return false;
  return SECRET_SHAPED.test(name) || (known && PROVIDER_SHAPED.test(name));
}

/** The names a template (.env.example and friends) lists, values ignored. */
export function templateNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m?.[1]) names.push(m[1]);
  }
  return names;
}

// A template file the vault reads names from (electron/dotenv.cjs TEMPLATE), at the root or in apps/* or packages/*.
export const isTemplate = (file: string) => /^(?:(?:apps|packages)\/[^/]+\/)?\.env\.(example|sample|template|dist|defaults)$/.test(file);

/** The URL path a route file serves, or null for one that isn't a route or takes a [param]. */
export function routePath(file: string): string | null {
  const app = /(?:^|\/)app\/(.+)\/route\.(?:ts|js|mjs|tsx|jsx)$/.exec(file);
  const pages = /(?:^|\/)pages\/(api\/.+)\.(?:ts|js|mjs)$/.exec(file);
  const rel = app?.[1] ?? pages?.[1]?.replace(/\/index$/, "");
  if (!rel) return null;
  const parts = rel.split("/").filter((p) => !/^\(.*\)$/.test(p) && !p.startsWith("@"));
  if (parts.some((p) => p.includes("["))) return null;
  return `/${parts.join("/")}`;
}

export type FoundHook = {
  // What it's for, e.g. "stripe"; the intake makes names unique within a folder.
  name: string;
  // The signature the relay verifies (lib/webhook-signatures.ts), when the code says.
  provider?: string;
  target: string;
  secret?: string;
  events?: string[];
  hint?: string;
};

// Who signs what a route receives, from what its code checks. svix is the wire shape Resend and Clerk use.
const SIGNERS: { provider: string; name: (text: string) => string; test: RegExp }[] = [
  { provider: "stripe", name: () => "stripe", test: /constructEvent(?:Async)?\(|stripe-signature/i },
  { provider: "github", name: () => "github", test: /x-hub-signature|@octokit\/webhooks/i },
  { provider: "vercel", name: () => "vercel", test: /x-vercel-signature/i },
  { provider: "svix", name: (t) => (/resend/i.test(t) ? "resend" : /clerk/i.test(t) ? "clerk" : "svix"), test: /svix/i },
];

// A generic path segment says nothing about who the hook is for.
const GENERIC = /^(?:api|v1|v2|trpc|webhooks?|hooks?|events?)$/i;

const REGISTER: Record<string, string> = {
  stripe: "Stripe dashboard → Developers → Webhooks: https://dashboard.stripe.com/webhooks",
  github: "GitHub → the repo's Settings → Webhooks",
  vercel: "Vercel → Team Settings → Webhooks",
  resend: "Resend → Webhooks: https://resend.com/webhooks",
  clerk: "Clerk → Configure → Webhooks: https://dashboard.clerk.com/last-active?path=webhooks",
};

// Event types the handler switches on, e.g. case "checkout.session.completed".
const EVENT = /(?:case\s+|===?\s*)["'`]([a-z][a-z_]*(?:\.[a-z_]+)+)["'`]/g;
const MAX_EVENTS = 50;

/** The webhook a route file receives, or null when it isn't one. */
export function findHook(file: string, text: string): FoundHook | null {
  const target = routePath(file);
  if (!target) return null;
  const signer = SIGNERS.find((s) => s.test.test(text));
  if (!signer && !/webhook/i.test(target)) return null;
  const parts = target.split("/").filter(Boolean);
  const named = parts.filter((p) => !GENERIC.test(p));
  // Nothing but generic segments and no signature check: a registry like Weft's own /api/webhooks, not a receiver.
  if (!signer && !named.length) return null;
  const at = parts.findIndex((p) => /^webhooks?$/i.test(p));
  // The segment before "webhook" names it, unless that segment says nothing (…/api/webhooks/stripe).
  const before = at > 0 ? parts[at - 1] : undefined;
  const fallback = (before && !GENERIC.test(before) ? before : named.at(-1)) ?? "webhook";
  // A signer names it from the code; svix's wire shape is shared, so the route may name it instead.
  const name = signer ? signer.name(`${text}\n${target}`) : fallback.toLowerCase();
  const secret = [...envReads(text)].find((n) => /WEBHOOK|SIGNING/.test(n));
  const events = [...new Set([...text.matchAll(EVENT)].map((m) => m[1] ?? ""))].slice(0, MAX_EVENTS);
  return {
    name,
    target,
    ...(signer && { provider: signer.provider }),
    ...(secret && { secret }),
    ...(events.length > 0 && { events }),
    ...(REGISTER[name] && { hint: REGISTER[name] }),
  };
}
