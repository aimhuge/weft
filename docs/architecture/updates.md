# Releases and updates

Weft ships as a Mac app with everything inside it: the Electron shell, the Next.js server (`Resources/server`) and
the board's UI. Nothing is hosted, so every change, UI or server, reaches people through an app update. The server
reads `~/.weft`, starts Claude Code and terminal shells, and answers only on 127.0.0.1, which a hosted page can't do.

## What's inside the app

| Where | What | How it gets there |
| --- | --- | --- |
| `Resources/app.asar` | `electron/` and the main process's only packages: `libsodium-wrappers` (the 🔐 vault) and `node-pty` (the terminal; its darwin prebuild unpacked beside the asar so the native module loads) | `build.files` in `package.json`; every other `node_modules` folder stays out |
| `Resources/server` | The Next.js standalone server, run by Weft Helper as Node (`electron/server.cjs`), with only the packages it imports, mostly the Agent SDK's Claude Code binary (~240 MB) | `next build` with `WEFT_STANDALONE=1`, then `scripts/prepare-standalone.mjs` |
| `Resources/toolchain` | The toolchain, below | `scripts/bundle-toolchain.mjs` |
| `Resources/plugin` | Weft's own skills | `extraResources` |

### Toolchain

A fresh Mac has no Node, pnpm, Claude Code or puku, and Weft users should still be able to build Next.js + Supabase
projects. `toolchain/bin` holds `node`, `npm`, `npx`, `pnpm`, `pnpx`, `puku-cli`, `claude` and `gog`: shell wrappers that run
on Weft Helper with `ELECTRON_RUN_AS_NODE=1` (Electron 44 is Node 24, the same major as Vercel's default), except
`claude`, which runs the Agent SDK's binary from `Resources/server`, and `gog`, the Google Workspace CLI: one Go binary
downloaded from its GitHub release and checked against a pinned sha256 (docs/architecture/connectors.md). `electron/main.cjs` appends the folder to the
**end** of PATH after `fixPath()` (`appendToolchain()` in `electron/env.cjs`), so threads, the terminal drawer, dev
servers and `which claude` / `which puku-cli` (login, puku threads) find them, and a Mac's own tools always win.

`scripts/bundle-toolchain.mjs` pins npm, pnpm and `@puku/puku-cli` (from the registry) and prunes puku: ripgrep and
sharp for other platforms, `better-sqlite3` (puku uses `node:sqlite`; the prebuilt binding has Node's ABI, not
Electron's), and its telemetry: OpenTelemetry goes, `@sentry/node` becomes a no-op stub. 426 → 196 MB, ~230 MB for
the whole toolchain. Not shipped: git (macOS offers the Command Line Tools on first use), gh, Docker, Homebrew;
`npx supabase` and `npx vercel` fetch those CLIs per project.

Verified on Electron's Node with nothing else on PATH: `create-next-app` (npm and pnpm), `next build` with Turbopack,
`@supabase/supabase-js`, `supabase` and `vercel` through npx / pnpm dlx, and a puku thread through the Agent SDK with a
tool call.

## Cutting a release

1. Bump `version` in `package.json` and commit it from a Weft thread. Weft commits the release notes right after on its
   own (docs/architecture/changelog.md): Unreleased in `CHANGELOG.md`, the committed entries plus any lines typed there,
   becomes `## [X.Y.Z] - date`.
2. Tag `vX.Y.Z` on that notes commit (HEAD), and push the tag. Tagging in the same Bash line as the bump commit tags the
   commit before the notes, and the release fails on the missing section.

A bump Weft didn't see (a Codex thread, a commit made outside Weft) gets its section by hand: `pnpm changelog:release X.Y.Z`.

Before the tag, the Copywriter writes the version's "What's new" splash (below) with `node scripts/release-splash.mjs X.Y.Z`.
The whole run, as it works today (commit, bump, splash, tag, build on a mini, publish, check weft.zip), is the repo-only
`/release` skill in `.claude/skills/release/SKILL.md`.

`.github/workflows/release.yml` runs on the tag, on an Apple silicon runner:

- refuses a tag that doesn't match `package.json`, runs the tests;
- `scripts/release-feed.mjs` writes `dist/update.json` and `dist/release-notes.md` from that version's CHANGELOG section
  (and fails when the section is missing);
- `pnpm dist:release` builds the dmg and zip (`Weft-X.Y.Z-arm64.*`), signed with the Developer ID certificate,
  hardened runtime with `build/entitlements.mac.plist`, and notarized;
- `pnpm dist:linux` (on a Linux box) builds `Weft-X.Y.Z-<arch>.AppImage` and `.deb`: unsigned, no auto-update feed yet. `bundle-toolchain.mjs` writes wrappers that find `resources/` and the `weft` binary instead of `Contents/`; `node-pty` has no Linux prebuild, so it is taken from `build/Release` after `pnpm install` compiles it;
- checks the signature with `codesign` and Gatekeeper with `spctl`;
- publishes a GitHub release with the dmg, the zip and `update.json`.

Local `pnpm dist` stays an unsigned `--dir` build (`CSC_IDENTITY_AUTO_DISCOVERY=false`, so no certificate in your
keychain gets picked up by accident). A local signed dmg is `NODE_ENV=production pnpm dist:release`: it signs with
the Developer ID in your keychain and skips notarization without the `APPLE_API_*` variables, so Gatekeeper on
another Mac asks before the first open.

### Building on the minis (`pnpm dist:remote`)

`scripts/package-remote.sh` runs the heavy part off this Mac: it picks m1mini, else m2mini (SSH reachable, 12 GB free;
`--host` forces one), rsyncs the working tree to `~/dev/weft-build`, runs `pnpm install`, the standalone `next build`,
`prepare-standalone` and `bundle-toolchain` there, and rsyncs `.next-dist` and `.toolchain-dist` back. electron-builder
then packs and signs here with the Flexbike Developer ID (`WEFT_SIGN_IDENTITY`, default `Flexbike, Inc. (H78XB55WG8)`),
because the private key lives only in this Mac's keychain. It notarizes when the `APPLE_API_*` variables are set.
`--check` only tests the builder and the identity; `--no-sign` packs unsigned.

### Secrets

| Secret | What |
| --- | --- |
| `MAC_CERT_P12_BASE64` | The "Developer ID Application" certificate and its key, exported as .p12, base64'd |
| `MAC_CERT_PASSWORD` | The .p12's export password |
| `APPLE_API_KEY_P8` | An App Store Connect API key (.p8 file contents), for notarization |
| `APPLE_API_KEY_ID` | That key's ID |
| `APPLE_API_ISSUER` | The issuer ID shown above the keys list |
| `WEFT_GOOGLE_CLIENT_ID` | Weft's own Google OAuth client id, baked into the build so Settings → Connectors can sign a Google account in with no setup |
| `WEFT_GOOGLE_CLIENT_SECRET` | That client's secret |

The certificate belongs to the Apple Developer team that publishes Weft; Gatekeeper shows its name. Weft publishes
from Alex Miller's individual membership, not Flexbike Inc's.

## Downloads

weft.zip's download button and `weft.zip/download` (`app/download/route.ts`, a 302 to the newest dmg; the link to
share) both read the release feed through `latestRelease()` in `lib/home-release.ts`, cached for minutes (Next's "minutes" profile: re-read at most once a minute), so a new release
reaches the site without a deploy.

## How an installed Weft updates (`electron/updater.cjs`)

- A packaged Weft fetches `https://github.com/aimhuge/weft/releases/latest/download/update.json` 30s after launch and
  every 4 hours (`WEFT_UPDATE_FEED` overrides it). Dev mode never checks on its own; it updates with `git pull`.
- `update.json` is Squirrel.Mac's static JSON feed (`currentRelease`, `releases[].updateTo.url` → the zip), plus
  `page` and `download` for the fallback.
- When the feed's version is newer, the feed goes to Electron's built-in `autoUpdater` (Squirrel.Mac), which downloads
  the zip in the background. No npm dependency: the app bundle ships no `node_modules`.
- Once downloaded: a notification, and the Weft menu's item becomes **Restart to Update to X**. The update also
  installs on the next quit. With threads running, restarting asks first: **Restart When Idle** (the default) arms the
  server's drain (`lib/restart-when-idle.ts`) with `then: "update"`, and once the last turn ends the server calls the
  control server's `POST /app/restart`, which runs `updater.installNow()`; **Restart Now** installs at once.
- Left alone, a ready update installs itself: every minute (`QUIET_CHECK_MS`) `installWhenQuiet()` restarts into it
  when the Mac has had no keyboard or mouse input for 10 minutes (`AWAY_SECONDS`, Electron's
  `powerMonitor.getSystemIdleTime()`) and the board reports exactly 0 running threads. A count the server couldn't give
  (an error, a 403) counts as busy, so it never cuts a turn off. The ready notification's click opens the Software
  Update window; its **Restart Now** button goes through the same `install()` as the menu, asking when threads run.
- Squirrel only installs into a signed app. An unsigned build (or any Squirrel error) falls back to **Download Weft
  X…**, which opens the release page.
- The Weft menu always has the item, and the File menu repeats it under New Thread (the only place off a Mac), and in the app it opens the **Software Update** window (`electron/update-window.cjs`,
  `update.html`, `update.js`, `update-preload.cjs`; the About window's pattern): this Mac's version, the newest, the last
  check, the release notes and one button for the next step (Check Now, Download…, Restart to Update). Opening it while
  idle checks right away. `electron/update-view.cjs` words each state (a feed 404 reads as "no release published yet");
  the updater keeps `notes`, `checkedAt`, `error` and `upToDate` in its state for it, and `updater.info()` hands it over.
  Without a window (`openWindow` unset) **Check for Updates…** falls back to message boxes.

## What's new after an update (`lib/release-splash.ts`)

The first time Weft opens on a version that has a splash, the board shows **What's new in Weft X** once: up to three
short lines, sometimes a video, **Full release notes** (the GitHub release) and **Nice** (`components/ReleaseSplash.tsx`,
mounted in `components/HeaderBadges.tsx`).

- The lines live in `lib/release-splashes.json` (`{ "X.Y.Z": { "lines": [...], "video"?: "/whats-new/X.Y.Z.mp4" } }`), which
  ships inside the app, so an update brings its own splash. A version with no entry shows nothing.
- `scripts/release-splash.mjs X.Y.Z [--video …] [--dry-run]` writes the entry in the Copywriter's voice: its soul from
  `lib/agents-built-in.json`, the version's CHANGELOG section as the brief, puku-cli (puku-ai-2.8) as the writer, or
  `claude -p` with `WEFT_SPLASH_CLI=claude`.
- `decideSplash()` reads the version last seen from localStorage (`weft-splash-version`). The same version: nothing. No
  welcome answered yet (a fresh install): record the version, show nothing, so new users meet the welcome, not release
  notes. Older or none stored with the welcome answered (someone who had Weft before the splash existed): show it.
  Newer stored (a downgrade): record quietly. The version is recorded as the splash opens, and decided once a launch
  (`lib/use-release-splash.ts`); an unreadable welcome leaves it for next launch.
- The video plays muted and looping, with controls for the sound (the feature intros' rule: nothing talks unasked).
- Settings → General → Reset tips clears the version seen (`resetOnboarding` in `lib/welcome-client.ts`), so the current
  splash shows again on the next launch: that's how to preview one in dev mode, where the version is `package.json`'s.

## Gaps

- v0.4.0 (2026-10-17) was published by hand: built from a clean `git archive` of the tag, signed with the Developer ID
  in the Keychain, not notarized (no Apple API key yet; `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8` are
  blanks in the vault), and `gh release create` with the dmg, zip and update.json. The tag's workflow run was cancelled:
  the repo has no signing secrets. Squirrel's install of a signed update is still unproven until 0.4.1.
- arm64 only. Intel Macs would need an `x64` (or `universal`) target and their own zip in the feed.
- No delta updates: each update downloads the full zip.
- `countRunning` in `updater.cjs` repeats the one in `keep-working.cjs`.
- The toolchain's versions are pinned in `scripts/bundle-toolchain.mjs` and move only when someone bumps them.
- A puku trial for people without a Puku account (Weft's key behind the deployed Weft) is its own card; until it
  lands, a puku thread needs `puku-cli auth login`.

## Channels (brew and apt): machinery only

Nothing publishes to Homebrew or apt yet and no workflow calls these; `scripts/release-channels.mjs` builds what a
channel needs from a release's artifacts, so turning one on is a CI step plus a repo.

- `node scripts/release-channels.mjs cask <version> [dmg]` writes `dist/weft.rb`, a Homebrew cask (url from the GitHub
  release, sha256 of the dmg). It belongs in a tap repo, `aimhuge/homebrew-weft` at `Casks/weft.rb`
  (`brew install --cask aimhuge/weft/weft`); the release URL must be public. The official homebrew-cask needs a notarized app and notability.
- `node scripts/release-channels.mjs apt <debDir>` makes a flat apt repo (`apt-ftparchive`, Linux) from the `.deb` files
  `pnpm dist:linux` writes; `Release` is signed with `$WEFT_APT_GPG_KEY` when set. Host `dist/apt` on any static site (R2, Pages).
