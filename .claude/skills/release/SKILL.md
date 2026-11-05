---
name: release
description: Ship a new Weft version end to end — commit the tree, bump the version, have the Copywriter write the "What's new" splash, tag, build and sign the dmg on a Mac mini, publish the GitHub release the installed apps update from (the OTA), and check weft.zip offers it. Use when the user says "release", "ship a new version", "build a new dmg", "push an OTA" or "cut X.Y.Z". Weft's own repo only.
argument-hint: "[version, default: next patch]"
---

Ship Weft `$ARGUMENTS` (or the next patch after `package.json`'s version). Releasing is described in
docs/architecture/updates.md; this is the order that works today, with the traps each step has hit.

Open a plan page in the pane first (one card per step below) and tick them off as you go.

## 1. Commit the working tree

- `git status --short | wc -l`. "Commit everything" means every thread's work: stage by path, never `git add -A`:
  `git ls-files -m -o -d --exclude-standard -z | xargs -0 git add --`, then one `git commit -F -` with a body naming the features.
- The pre-commit hook type-checks and lints the staged files on their own. When it refuses, fix the errors (usually
  in-flight test files and `.cjs` JSDoc types), run `pnpm typecheck` once, test the files you touched, and commit again.
  Never `--no-verify`.
- Secret scanners: a test fixture shaped like a real token (`xoxb-…`, `ghp_…`, `AKIA…`) makes GitHub refuse the push.
  Build it at runtime instead (`"xoxb" + tail`). If an unpushed commit already has one, rebuild the unpushed commits
  with the fixed blob on a temporary index (`GIT_INDEX_FILE`, `read-tree`, `update-index --cacheinfo`, `write-tree`,
  `commit-tree`, then `update-ref refs/heads/main <new> <old>`) — no amend, no reset, no stash: other threads share the tree.

## 2. Bump the version

- Set `"version"` in `package.json` and commit it alone (`chore(release): X.Y.Z`). Weft then commits that version's
  CHANGELOG section itself (`docs(changelog): X.Y.Z`) and says so in the hook note. Wait for that note; tagging before it
  tags the commit without notes.
- A bump Weft didn't see: `pnpm changelog:release X.Y.Z`.

## 3. The "What's new" splash

- `node scripts/release-splash.mjs X.Y.Z --dry-run` asks the Copywriter (its soul from `lib/agents-built-in.json`, the
  CHANGELOG section as the brief) for up to three short lines. Read them; run again without `--dry-run` to write them
  into `lib/release-splashes.json`. A release with a video: `--video /whats-new/X.Y.Z.mp4`, with the mp4 in `public/whats-new/`.
- A patch nobody would notice can skip it: no entry, no splash.
- Commit `lib/release-splashes.json` (`docs(splash): X.Y.Z`) before tagging, so the build carries it.

## 4. Tag and push

- `git tag vX.Y.Z` on HEAD (the notes commit, or the splash commit after it), then `git push origin main` and
  `git push origin vX.Y.Z` (aimhuge/weft).
- The tag starts `.github/workflows/release.yml`. The repo has no signing secrets, so cancel that run:
  `gh run list -R aimhuge/weft -w release.yml -L 1`, then `gh run cancel <id> -R aimhuge/weft`.

## 5. Build and sign

- `scripts/package-remote.sh --check` (a mini reachable, the Flexbike Developer ID in this keychain).
- `NODE_ENV=production scripts/package-remote.sh` in the background, logging to a file outside the repo (~10 minutes:
  the Next build on m1mini, then electron-builder packs and signs here). Watch it with a Monitor on `^==|error|exit`.
- It ends with `dist/Weft-X.Y.Z-arm64.dmg` and `.zip`, `codesign` saying "satisfies its Designated Requirement", and
  "not notarized" while `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and `APPLE_API_KEY_P8` are blanks in the vault.

## 6. Publish (the OTA)

- `node scripts/release-feed.mjs X.Y.Z dist` writes `dist/update.json` and `dist/release-notes.md`.
- `gh release create vX.Y.Z -R aimhuge/weft --title "Weft X.Y.Z" --notes-file dist/release-notes.md dist/Weft-X.Y.Z-arm64.dmg dist/Weft-X.Y.Z-arm64.zip dist/update.json`
- Check: `curl -sL https://github.com/aimhuge/weft/releases/latest/download/update.json` names X.Y.Z. Installed Wefts
  check 30s after launch and every 4 hours, or now with Weft → (or File →) Check for Updates….

## 7. weft.zip

- The home page and `weft.zip/download` read the feed through `lib/home-release.ts` (Next's "minutes" cache), so they
  follow within a couple of minutes with no deploy. Check: `curl -sI https://weft.zip/download | grep -i location`
  points at the X.Y.Z dmg. A deploy older than that change can lag up to an hour; a production redeploy is the user's call.

## Wrap up

Show the release page in the pane, and say what shipped: version, signed or notarized, the splash lines, and anything
skipped (CI cancelled, not notarized).
