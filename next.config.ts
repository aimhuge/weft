import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // NEXT_PUBLIC_SITE_URL is where @aimhuge/teams points invite links (its siteOrigin()); it's inlined at build.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "https://weft.zip" },
  // `pnpm app` builds into its own folder so it never collides with a running dev server.
  distDir: process.env.WEFT_DIST || ".next",
  // `pnpm dist` builds a self-contained server that the packaged Weft.app runs.
  output: process.env.WEFT_STANDALONE ? "standalone" : undefined,
  // Local threads run AI in the desktop server. Include the SDK and native CLI in its standalone
  // package, but don't ship that runtime with Vercel's server, which relays work to desktop.
  outputFileTracingIncludes: {
    // app/faq/page.tsx reads the FAQ from disk.
    "/faq": ["./docs/FAQ.md"],
    // app/opengraph-image.tsx reads its font and pictures from disk when Vercel renders it on demand.
    "/opengraph-image": ["./public/fonts/fraunces-500.ttf", "./electron/assets/splash-speeder.jpg", "./electron/assets/emblem.png"],
    // A shared mini app's card (lib/app-card-image.tsx): the same font and emblem.
    "/api/a/[id]/og": ["./public/fonts/fraunces-500.ttf", "./electron/assets/emblem.png"],
    "/api/apps/share/preview": ["./public/fonts/fraunces-500.ttf", "./electron/assets/emblem.png"],
    ...(process.env.WEFT_STANDALONE
      ? {
          // The SDK finds its native Claude Code binary with a runtime require.resolve that tracing can't
          // see, so pull in the platform package explicitly for the packaged desktop server.
          "/**/*": [
            "./node_modules/@anthropic-ai/claude-agent-sdk/**/*",
            `./node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/**/*`,
          ],
        }
      : {}),
  },
  // lib/login.ts runs a CLI by a runtime path, which makes tracing pull in the whole project
  // folder; keep electron-builder's output (dist/) out of it. These globs match anywhere in a path,
  // so a bare "dist/**" would also drop .next-dist/server/chunks. scripts/prepare-standalone.mjs
  // prunes the source files that come along.
  outputFileTracingExcludes: {
    "/**/*": ["./dist/mac*/**/*", "./dist/Weft-*", "./dist/builder-*"],
  },
  // weft.zip/@username is a public profile. A route folder can't start with "@" (a parallel-route slot), so the
  // handle is rewritten to app/u/[username]; beforeFiles so the [orgSlug] segment never sees it.
  rewrites() {
    return Promise.resolve({ beforeFiles: [{ source: "/@:username", destination: "/u/:username" }], afterFiles: [], fallback: [] });
  },
  cacheComponents: true,
  partialPrefetching: true,
  // The Agent SDK spawns the CLI from files inside its own package, so it must not be bundled.
  // esbuild (lib/app-build.ts, the mini-app bundler) ships the platform binary through package.json exports
  // (node_modules/@esbuild/darwin-arm64/bin/esbuild); when Turbopack resolves it on the server it 500s every
  // route that imports it transitively (2026-10-19). Externalize it the same way.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "esbuild"],
  // The "N" dev badge sits over the board's bottom-left corner; compile and runtime errors still show.
  devIndicators: false,
  // The desktop shell loads the app from 127.0.0.1, not localhost.
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Server Fast Refresh sometimes sends a launch into a loop: each request for the board applies a server update
    // that counts as a change, which makes the board refetch, a couple of times a second, so it never gets past
    // its placeholder cards (vercel/next.js#94915). Off, a server file change reloads that route's server modules
    // on the next request instead; runner state lives on globalThis, so threads and sessions survive it.
    turbopackServerFastRefresh: false,
    // Marks this app as upgraded by `next upgrade --agent=security` (16.4.0 → 16.4.2 for a published advisory).
    agentUpgrade: "security",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
