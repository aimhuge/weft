# 047: the packaged app couldn't find the Supabase client, and died on launch

**Date:** 2026-10-28 · **Severity:** High (the shipped app crashed in the main process before a window opened — no
board, no browser pane, no error the user could act on beyond a native "A JavaScript error occurred in the main
process" dialog)

## Symptom

The packaged Weft app refused to start. macOS showed a native error dialog:

```
Uncaught Exception:
Error: Cannot find module '@supabase/supabase-js'
Require stack:
- /Applications/Weft.app/Contents/Resources/app.asar/electron/account-client.cjs
- /Applications/Weft.app/Contents/Resources/app.asar/electron/main.cjs
```

The dev build worked fine. The board was reachable, the vault worked, the sign-in worked — everything was correct
except the packaged app, and only the packaged app.

## Root cause

**`electron-builder`'s `files` list drops the whole top-level `node_modules`.** The rule that does it is one character
of glob:

```json
"files": [
  "electron/**/*",
  "package.json",
  "!node_modules${/*}"
]
```

`!node_modules${/*}` negates every path under `node_modules`, so nothing from it reaches `app.asar` unless a later
pattern names it again. The list did name three packages back — `libsodium`, `libsodium-wrappers` and `node-pty` —
because Electron main needs them and someone remembered to add them.

**The shared vault added a fourth require and nobody added the package.** `feat(vault): shared team vault across
devices and teammates` (08db945) added `electron/account-client.cjs`:

```js
const { createClient } = require("@supabase/supabase-js");
```

`@supabase/supabase-js` was in `package.json`'s `dependencies` — so `pnpm install` put it in `node_modules`, the
Next server's standalone bundle shipped it (that copy comes from `extraResources`, a different path entirely), and
the dev build found it. Everything that checked a dependency said the dependency was satisfied.

But nothing checked the *packaged* app's `node_modules`, because the packaged app's `node_modules` isn't
`node_modules` — it's the handful of packages the `files` list names, copied into `app.asar`. The package was
there for the server and absent for the desktop.

**So the build produced an app that could not start.** The failure was total and silent until launch: main loads
`account-client.cjs` at startup, the require throws, and the main process dies before a window exists. Every
packaged build from that commit was broken, and nothing in CI or the test suite could see it — the tests run
against the repo's `node_modules`, where the package is present.

## Fix

**The package list is derived, not hand-kept.** `scripts/electron-runtime-deps.mjs` computes the closure of packages
Electron main needs at runtime and writes it into `build.files`; `pnpm dist` runs it before electron-builder, so a
new `require()` ships with its package instead of waiting for someone to remember.

The closure is: the bare `require()`s out of `electron/*.cjs`, then the runtime requires out of each package it
finds, transitively. Two details make it right:

- **Both the CommonJS and the ESM entry are read.** A package's `main` can vendor its own copy of a dependency that
  its `module` build imports from the package itself: realtime-js's `dist/main` vendors its own phoenix, while its
  `dist/module` imports `@supabase/phoenix`. Reading only `main` misses it, and the packaged app can't resolve it.
- **Only packages Weft has installed count.** An optional peer (React Native, expo) isn't something the packaged app
  can ship, and the manifest overstates what a package needs: `node-pty` lists `node-addon-api` as a dependency, but
  that is compile-time — the app ships node-pty's prebuilt `pty.node`, which loads without it.

The result for today: `libsodium`, `libsodium-wrappers`, `node-pty`, and the Supabase client with its tree
(`@supabase/{auth,functions,phoenix,postgrest,realtime,storage}-js`, `iceberg-js`, `tslib`,
`@opentelemetry/api`).

**`electron/packaged-deps.test.ts` is the guard, so the list can't drift.** It fails if `build.files` differs from
what the script computes — so a `require()` added without its package fails the test suite.

**`scripts/verify-packaged-app.cjs` checks the built app.** It reads the archive itself: a package counts as shipped
only if `app.asar` holds it. Resolving with `createRequire()` from inside the asar is *not* enough — Node walks the
real filesystem and finds the repo's `node_modules`, which has everything, so a broken asar would still pass. (The
first version of this script made exactly that mistake and gave a false "ok" on an asar missing every Supabase
package.) It then loads the packaged `account-client.cjs` out of the archive and builds a Supabase client from it —
the exact require that crashed the app. `pnpm dist` runs it at the end, so a build that would crash on launch fails
the build instead.

**Key rule:** a dependency being in `package.json` says it is installed; it says nothing about whether it is in the
*shipped app*. The packaged app's `node_modules` is an allow-list, and anything Electron main requires has to be on
it — derived by a script, checked by a test, and verified against the built archive.

## The app now checks its own bundle (`electron/runtime-deps.cjs`)

The derivation and the build-time verification catch a missing package *before it ships*. They can't catch a bundle
that arrives broken another way — an interrupted install, a half-copied update — so the app checks itself at boot,
before anything needs the packages. A missing one now shows the splash's error state with the package named and
"Reinstall Weft to repair it", instead of the native dialog.

**The check reads the bundle, not the machine.** Inside `app.asar`, Node's resolution walks out of the archive and
finds the real `node_modules` next to the app — or the repo's, when Weft runs from source — so a plain
`require.resolve()` says "found" for a package the bundle doesn't have. This is the same trap
`verify-packaged-app.cjs` documents, and the first version of the check fell into it: it reported a broken bundle
as fine. The check asks the bundle instead. Electron's patched filesystem reads an archive as a folder, so the
package's manifest is a real file inside it, and `fs.existsSync` on it is the honest answer.

**The require is lazy.** `electron/account-client.cjs` requires `@supabase/supabase-js` when the client is first
built, not when the module loads. A bundle missing the package still opens a window and can say so, instead of
dying during startup.

## What an auto-update installs (`electron/toolchain-install.cjs`, `electron/updated-since.cjs`)

Squirrel.Mac replaces the whole `.app` bundle, so an update brings the app's own dependencies *with* it —
`app.asar`'s packages and the Next standalone bundle are already installed when the app restarts. Running
`pnpm install` against them would be meaningless (they're inside the archive) and would write a `node_modules`
folder nothing reads.

The one tree on disk that is installed *separately* from the bundle is the toolchain's puku tree:
`scripts/bundle-toolchain.mjs` installs it at build time from a caret range with no lockfile, then prunes packages
out of it. So after an update, the app runs `pnpm install` against that tree — in the background, because the board
never waits for it.

The app knows an update landed by the version changing since the last launch (`~/.weft/updated-version`), so an
ordinary relaunch installs nothing and only checks the tree.

## Verification

Built the package and ran `scripts/verify-packaged-app.cjs` against both asars:

- the **old** asar (the one that crashed) fails with 11 problems, ending in the user's own error:
  `Cannot find module '@supabase/supabase-js'`;
- the **new** asar passes every package and loads the account client and builds a Supabase client from inside the
  archive.

The regression test was also confirmed to fail when the fix is reverted.

The boot-time check was confirmed in Electron, against the real archives — the only place the archive's own
filesystem is in play:

- a bundle with `@supabase/supabase-js` removed (the old one, rebuilt) reports `ok: false` and names it:
  `Weft couldn't find some of its own files (missing from the app bundle: @supabase/supabase-js). Reinstall Weft to
  repair it.`;
- the rebuilt bundle reports `ok: true`, and the packaged client loads from inside the archive.

The same check, run outside Electron, reported `ok: true` on the broken bundle — the trap described above, and the
reason the check reads the archive rather than resolving.

## Files

- `scripts/electron-runtime-deps.mjs` — computes the runtime closure and writes `build.files`
- `scripts/verify-packaged-app.cjs` — checks the built asar holds the closure and that the packaged account client
  loads from it
- `scripts/verify-packaged-toolchain.cjs` — checks the bundled pnpm runs, matches `packageManager`, and can install
- `package.json` — `build.files` (derived), and `dist` runs the derivation and the verification
- `electron/packaged-deps.test.ts` — the guard: `build.files` must equal the closure
- `electron/runtime-deps.cjs` — the boot-time check: the packages are really in the bundle
- `electron/account-client.cjs` — the Supabase client is required lazily, so a bundle missing it still opens a window
- `electron/toolchain-install.cjs` — runs the bundled pnpm over the toolchain's trees
- `electron/updated-since.cjs` — knows an update landed, by the version changing
- `electron/boot-deps.cjs` — the boot-time step: check the bundle, install the toolchain's trees
- `docs/architecture/desktop-shell.md` — the packaging section says what the allow-list is and how it is derived
- `docs/architecture/updates.md` — what an update brings, and what it installs
