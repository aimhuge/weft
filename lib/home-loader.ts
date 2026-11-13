// Loads the weft.zip home page (components/home/Home) for app/page.tsx and app/home/page.tsx, and nothing else.
//
// It lives apart from lib/home.ts on purpose. lib/home.ts is plain data and helpers (isDeployed, platformLinks, SITE)
// that half the server imports, the board's /api/cards among them via lib/analytics-server.ts. When loadHome sat in
// lib/home.ts, its import of components/home/Home put the whole home page into every one of those routes' bundles,
// so on 2026-11-12 a stylesheet the home-page redesign hadn't written yet (./story.css) 500'd /api/cards and Weft
// wouldn't start. A dynamic import() narrows a *runtime* error, but Turbopack still resolves the target's imports at
// build time, so a missing file fails every route that can reach it. Only the two page routes import this file;
// lib/home-loader.test.ts checks that no other lib/ or app/api/ file reaches components/home.
//
// See docs/bug-fixes/011-home-parse-error-took-board-down.md for the parse-error side of the same story.

// The home page component's props (the call site decides). `unknown` keeps the helper generic.
type HomeComponent = (props: unknown) => unknown;

// The shape `loadHome` returns when the import fails: what the route's fallback renders and what the build error
// bar shows. One message, one optional file (parsed out of Next's "X:Y" hint when we have it).
export interface HomeLoadError {
  message: string;
  file: string | null;
}

// The result of one load attempt: the component on success, an error on failure. Routes decide what to render.
export type HomeLoadResult = { Home: HomeComponent } | { error: HomeLoadError };

// Lazy-loads @/components/home/Home so a parse error in it (a stray `}`) cannot 500 the page that imports this
// helper. Cached after the first successful load so re-renders don't re-import; the cache resets on each cold start
// of the dev server, which is when Fast Refresh clears its own module cache anyway. `importer` is for tests.
let cached: HomeComponent | null = null;
export async function loadHome(importer: () => Promise<{ default: HomeComponent }> = defaultImporter): Promise<HomeLoadResult> {
  if (cached) return { Home: cached };
  try {
    const mod = await importer();
    if (typeof mod.default !== "function") {
      return { error: { message: "components/home/Home has no default export", file: null } };
    }
    cached = mod.default;
    return { Home: cached };
  } catch (err) {
    // Next's dev overlay says "Unexpected token. Did you mean `{'}'}` or `&rbrace;`?" with no file; the file is in
    // the import trace just above. We surface a short, file-bearing message the fallback can show.
    const raw = err instanceof Error ? err.message : String(err);
    const file = raw.match(/\.\/([^\s()]+\.[a-z]+)/)?.[1] ?? null;
    return { error: { message: raw.split("\n")[0] || "Failed to load components/home/Home", file } };
  }
}

async function defaultImporter(): Promise<{ default: HomeComponent }> {
  // Dynamic so a parse error in the target only surfaces when this runs, not when the page module loads.
  const mod = await import("@/components/home/Home");
  return mod;
}

// Test-only: clear the in-process cache so the next loadHome() call re-imports.
export function _resetLoadHomeCacheForTests(): void {
  cached = null;
}
