// Weft calls home only from weft.zip. Every Mac runs the same Next app on localhost (and `next dev` at that), so a
// PostHog key set there must not start sending a builder's board, prompts or replies anywhere
// (docs/architecture/analytics.md). The browser checks the page's host; the server checks isDeployed() (lib/analytics-server.ts,
// apart so client code never reaches lib/home.ts and its "use cache" import).

export interface PosthogConfig {
  token: string;
  host: string;
}

// The two NEXT_PUBLIC_ values are read literally as defaults so Next inlines them into the browser bundle.
export function posthogConfig(
  token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  host = process.env.NEXT_PUBLIC_POSTHOG_HOST,
): PosthogConfig | null {
  return token && host ? { token, host } : null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", ""]);

// "" is a file: page (the browser pane's own pages); *.localhost covers Next's dev hosts.
export function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}
