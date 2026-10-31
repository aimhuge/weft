// The rewrites that turn weft.zip's public app links into the route folders that serve them. Hosted mini
// apps (docs/architecture/mini-app-hosting.md) live at /@<username>/apps/<slug> and /<org>/apps/<slug>,
// shared threads (docs/architecture/sharing.md) at /@<username>/threads/<slug>.
// proxy.ts calls appLinkTarget(pathname) for the rewrite; a request to a reserved first segment
// (every first-level folder under app/, plus the Next internal _next) returns null so the proxy
// returns NextResponse.next() at once with no session work.
//
// The reserved set is a hard-coded constant: this module runs on Vercel at the edge, where the
// app/ folder is in the bundle and not on the filesystem, so a runtime scan would always see an
// empty set. The lib/app-routes.test.ts file lists the folders directly under app/ and asserts
// every one is in the reserved set, so a new top-level folder fails the test until it's added
// here on purpose. Keep the set a Set, sorted longest-first when the proxy reads it.
const RESERVED: ReadonlySet<string> = new Set<string>([
  "_next",
  "a",
  "api",
  "app",
  "auth",
  "billing",
  "checkout",
  "copilot",
  "download",
  "faq",
  "home",
  "invite",
  "login",
  "pair",
  "privacy",
  "s",
  "t",
  "team",
  "terms",
  "u",
  "w",
  "worker.sh",
]);

// Every reserved first segment as a sorted array (longest first) — used by the rule and by tests
// to assert a new folder is in the set.
export function allReserved(): string[] {
  return [...RESERVED].sort((a, b) => b.length - a.length);
}

// A slug's regex, the same shape as APP_SLUG_RE in lib/app-share-types.ts.
export const USERNAME_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

// The user rule: /@<username>/apps/<slug> → /u/<username>/apps/<slug>. The first segment is
// "@<username>" so the /@ prefix and the username are together. parts[0] starts with @, and the
// username is what follows.
function userMatch(parts: string[]): { username: string; slug: string } | null {
  if (parts.length !== 3) return null;
  const first = parts[0] ?? "";
  if (!first.startsWith("@") || first.length < 2) return null;
  const username = first.slice(1);
  const slug = parts[2] ?? "";
  if (!USERNAME_SLUG_RE.test(username) || !USERNAME_SLUG_RE.test(slug)) return null;
  return { username, slug };
}

// The org rule: /<org>/apps/<slug> → /w/<org>/apps/<slug>. The org segment is rejected if it
// matches a reserved first segment exactly, so /api/apps/share never reaches the rule.
function orgMatch(parts: string[], reserved: ReadonlySet<string>): { org: string; slug: string } | null {
  if (parts.length !== 3) return null;
  const org = parts[0] ?? "";
  const slug = parts[2] ?? "";
  if (reserved.has(org)) return null;
  if (!USERNAME_SLUG_RE.test(org) || !USERNAME_SLUG_RE.test(slug)) return null;
  return { org, slug };
}

// The rewrite target for a request pathname, or null when the path isn't an app link. Pure: the
// reserved set is passed in so the test can use its own. proxy.ts reads the default set from
// this module via allReserved(). No I/O, no I/O on the request.
export function appLinkTarget(pathname: string, reserved: ReadonlySet<string> = new Set(allReserved())): string | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  // Strip a single trailing slash; a double slash is its own URL shape and stays a request for the
  // path that includes it, which can't be an app link anyway.
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const parts = trimmed.split("/").slice(1);
  // A shared thread's address, /@<username>/threads/<slug> (lib/share-types.ts threadPublicUrl): user links only.
  if (parts[1] === "threads") {
    const thread = userMatch(parts);
    return thread ? `/u/${thread.username}/threads/${thread.slug}` : null;
  }
  if (parts[1] !== "apps") return null;
  const user = userMatch(parts);
  if (user) return `/u/${user.username}/apps/${user.slug}`;
  const org = orgMatch(parts, reserved);
  if (org) return `/w/${org.org}/apps/${org.slug}`;
  return null;
}

// The matcher entries for proxy.ts's config: the org rule needs a wildcard that filters to /apps/
// at the second segment, which path-to-regexp's named parameters handle directly. The user rule's
// /@ prefix is a literal; path-to-regexp treats :name as the named capture and the @ stays.
export function appLinkMatchers(): string[] {
  // /@<username>/apps/<slug>: path-to-regexp accepts @ as a literal in a :name position when the
  // source begins with it, so /@:username/apps/:slug matches /@<x>/apps/<y> only. Proxy's
  // appLinkTarget confirms the username + slug shapes.
  return ["/@:username/apps/:slug", "/:org/apps/:slug", "/@:username/threads/:slug"];
}
