import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pkg from "./package.json";

// The short commit this build is made from, so a Mac can report which build it runs (lib/app-version-sync.ts). Empty
// when there's no git checkout to read.
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
})();

const nextConfig: NextConfig = {
  // NEXT_PUBLIC_SITE_URL is where @aimhuge/teams points invite links (its siteOrigin()); it's inlined at build.
  // WEFT_GOOGLE_CLIENT_ID/SECRET are Weft's own Google OAuth client (a Desktop app, lib/gog.ts): with them
  // baked in, a released build signs a Google account in without the user creating a client of their own.
  // An installed app's client secret isn't confidential to Google, but it stays out of git and comes from
  // GitHub secrets at release time (.github/workflows/release.yml).
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_COMMIT: commit,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || "https://weft.zip",
    ...(process.env.WEFT_GOOGLE_CLIENT_ID ? { WEFT_GOOGLE_CLIENT_ID: process.env.WEFT_GOOGLE_CLIENT_ID } : {}),
    ...(process.env.WEFT_GOOGLE_CLIENT_SECRET ? { WEFT_GOOGLE_CLIENT_SECRET: process.env.WEFT_GOOGLE_CLIENT_SECRET } : {}),
  },
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
    // A shared thread's card draws with the same one (app/api/s/[id]/og).
    "/api/s/[id]/og": ["./public/fonts/fraunces-500.ttf", "./electron/assets/emblem.png"],
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
  // A fs or spawn call on a runtime path (~/.weft, a user's repo, a CLI home) makes Turbopack trace the whole project
  // into a server function, which Vercel then uploads. Those calls carry /*turbopackIgnore: true*/; these excludes
  // drop the rest of what no server function reads from disk. Turbopack matches an exclude anywhere in a path, not
  // from the project root, so "./lib/**" would also strip node_modules/typescript/lib: only name folders no package
  // ships at runtime, and keep what outputFileTracingIncludes reads (docs/FAQ.md, electron/assets). Next also matches
  // them as absolute paths that may stop short of the file, so a bare "dist/**" would drop .next-dist/server/chunks.
  // scripts/prepare-standalone.mjs prunes the source files that still come along into the desktop build.
  outputFileTracingExcludes: {
    "/**/*": [
      "./dist/mac*/**/*",
      "./dist/Weft-*",
      "./dist/builder-*",
      "./electron/*.{cjs,cts,ts,js,json,html}",
      "./docs/!(FAQ.md)",
      "./docs/*/**/*",
      "./node_modules/{electron,electron-builder,electron-publish,electron-winstaller,app-builder-bin,app-builder-lib,dmg-builder,7zip-bin}/**/*",
      "./node_modules/{@electron,builder-util,builder-util-runtime}/**/*",
      // weft.zip relays AI work to the desktop and never starts Claude Code, so leave its native binary (~225 MB,
      // traced into every route that imports the SDK) out of Vercel's functions; the desktop build needs it.
      ...(process.env.WEFT_STANDALONE ? [] : ["./node_modules/@anthropic-ai/claude-agent-sdk-*/**/*"]),
    ],
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
  // multicast-dns (lib/lan-offer.ts, the LAN path to a worker) opens a UDP socket: loaded from node_modules as it is.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "esbuild", "multicast-dns"],
  // @weft/client (packages/weft-client) is a workspace package that ships TypeScript source, so Next compiles it with
  // the app's own code instead of loading it from node_modules at runtime.
  transpilePackages: ["@weft/client"],
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
    // The @aimhuge packages are linked, not copied: package.json points at link:../components/packages/<name>,
    // so node_modules/@aimhuge/sheet is a symlink out of the repo and the files it resolves to live outside
    // this root. Turbopack refuses a webpack loader on a path outside its roots ("... is outside configured
    // roots"), so app/globals.css's @import "@aimhuge/sheet/sheet.css" panicked the whole dev server.
    // These roots say where those symlinks may resolve into. The paths are the ones package.json links to.
    turbopackAdditionalRoots: {
      sheet: { path: path.join(__dirname, "../components/packages/sheet"), ignoreIfMissing: true },
      share: { path: path.join(__dirname, "../components/packages/share"), ignoreIfMissing: true },
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    // libsodium-wrappers 0.7.16's ESM build imports a ./libsodium.mjs it doesn't ship; its CommonJS build works
    // (lib/sodium.ts, docs/architecture/mobile-security.md). In the browser, its `fs`/`path` requires sit behind a
    // Node check and never run.
    resolveAlias: {
      "libsodium-wrappers": "./node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js",
    },
  },
};

export default nextConfig;
