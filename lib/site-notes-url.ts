// Where a site note belongs: a host and a general path (docs/architecture/site-notes.md). A concrete URL
// (`https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api?tab=keys`) becomes
// `supabase.com` + `/dashboard/project/:ref/settings/api`, so one note serves every project and no one's
// project ref, org id or email ever lands in a shared note. Pure.

export type NoteKey = { host: string; path: string };

const MAX_SEGMENTS = 12;

// Segments that are someone's value rather than part of the site's map. Order matters: the first hit names it.
const SEGMENT_RULES: Array<[RegExp, string]> = [
  [/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, ":email"],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ":id"],
  [/^\d+$/, ":id"],
  [/^[0-9a-f]{12,}$/i, ":id"],
  // Supabase project refs: 20 lowercase letters.
  [/^[a-z]{20}$/, ":ref"],
  // Prefixed ids (Stripe's acct_…, cus_…, prod_…; Vercel's prj_…, team_…).
  [/^[a-z]{2,8}_[A-Za-z0-9]{8,}$/, ":id"],
  // A long token with digits and letters mixed, the shape of generated ids.
  [/^(?=.*\d)(?=.*[a-zA-Z])[A-Za-z0-9_-]{16,}$/, ":id"],
];

// Path segments that name an account, an org or a repo on well-known dashboards, by their position after a
// fixed word. `/acme-inc/settings` on github.com is someone's org; `/settings` alone is the site's.
const OWNER_AFTER = /^(org|orgs|organizations|team|teams|project|projects|workspace|workspaces|users?|u)$/i;
const OWNER_FIRST_HOSTS = /(^|\.)(github\.com|gitlab\.com|vercel\.com|bitbucket\.org|huggingface\.co|netlify\.com)$/;

// The site's own words GitHub-style hosts put first: never an owner or a repo.
const SITE_WORDS = new Set(["settings", "login", "signup", "new", "dashboard", "account", "orgs", "organizations", "marketplace", "notifications", "explore", "pricing", "docs", "api", "apps", "teams", "integrations", "support"]);

export function generalSegment(segment: string): string {
  let raw = segment;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    // A malformed escape stays as it was.
  }
  for (const [pattern, name] of SEGMENT_RULES) if (pattern.test(raw)) return name;
  // Paths keep their case: some sites' are case-sensitive, and a lowercased one would 404.
  return raw;
}

export function generalizePath(pathname: string, host = ""): string {
  const parts = pathname.split("/").filter(Boolean).slice(0, MAX_SEGMENTS).map(generalSegment);
  const ownerFirst = OWNER_FIRST_HOSTS.test(host);
  const out: string[] = [];
  parts.forEach((part, i) => {
    const site = part.startsWith(":") || SITE_WORDS.has(part.toLowerCase());
    if (!site && ownerFirst && i === 0) out.push(":owner");
    else if (!site && ownerFirst && i === 1 && out[0] === ":owner") out.push(":repo");
    else if (!site && i > 0 && OWNER_AFTER.test(String(parts[i - 1]))) out.push(":name");
    else out.push(part);
  });
  return `/${out.join("/")}`;
}

// The note's key for a URL, or null when it isn't a site worth a note (not http(s), a local or private host).
export function noteKeyFor(url: string): NoteKey | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host || isPrivateHost(host)) return null;
  return { host, path: generalizePath(parsed.pathname, host) };
}

// Hosts that are this Mac or its network: a dev server's notes are no use to anyone and shouldn't be kept.
export function isPrivateHost(host: string): boolean {
  if (/^(localhost|0\.0\.0\.0|\[?::1\]?)$/.test(host) || /\.(localhost|local|internal|lan|test)$/.test(host)) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

// Hosts that are someone's own app on a shared platform (`my-app.vercel.app`): fine to keep for yourself or
// your team, but a public note would only announce the app exists, and no one else visits it.
const PERSONAL_SUFFIXES = /\.(vercel\.app|netlify\.app|pages\.dev|workers\.dev|github\.io|herokuapp\.com|supabase\.co|fly\.dev|onrender\.com|ngrok\.io|ngrok-free\.app|ngrok\.app|repl\.co|replit\.app|web\.app|firebaseapp\.com|azurewebsites\.net|cloudfront\.net|amplifyapp\.com|railway\.app|weft\.zip)$/;

export function isPublicShareable(host: string): boolean {
  if (isPrivateHost(host) || PERSONAL_SUFFIXES.test(host)) return false;
  return !/^\d+\.\d+\.\d+\.\d+$/.test(host) && host.includes(".");
}

// Does a note's path cover this general path? `:x` in the note matches any one segment.
export function pathMatches(notePath: string, path: string): boolean {
  const a = notePath.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i] || (seg.startsWith(":") && b[i] !== undefined));
}

// A file-safe name for a note's path, for ~/.weft/site-notes/<host>/<slug>.md.
export function pathSlug(path: string): string {
  const slug = path
    .replace(/^\/+|\/+$/g, "")
    .replace(/:/g, "_")
    .replace(/[^a-z0-9_.-]+/gi, "~");
  return slug || "_root";
}
