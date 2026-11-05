# Weft on Windows

Weft ships for Windows as an **unsigned NSIS installer**, one per architecture (`Weft-Setup-X.Y.Z-x64.exe` and `Weft-Setup-X.Y.Z-arm64.exe`, from `artifactName` `Weft-Setup-${version}-${arch}.${ext}`), built on GitHub Actions, on
the same GitHub Release as the Mac dmg, and it updates itself with **electron-updater** from that release. No money
is spent: code signing costs ~$10/month (Azure Artifact Signing, US/CA/EU/UK orgs only) or $200–500/year (an OV
certificate), and the trade for skipping it is one SmartScreen prompt on the first install.

## Installing

1. Download `weft.zip/download/windows` (x64) or `weft.zip/download/windows?arch=arm64`: a 302 to the newest
   `Weft-Setup-X.Y.Z-<arch>.exe`. `app/download/windows/route.ts` reads the release's `latest.yml` (x64) or
   `latest-arm64.yml` through `latestWindowsInstaller(arch)` in `lib/home-release.ts` (`WINDOWS_ARM_FEED` in
   `lib/home.ts`). The home page's note under the download button links both ("On Windows?", "On Windows? (ARM)").
2. SmartScreen says **Windows protected your PC**: **More info → Run anyway**. Only this first install asks; the
   installer is unsigned, and Windows has no reputation for it yet.
3. The installer is one-click and per-user (`nsis.oneClick`, `perMachine: false`): no admin prompt, installed under
   `%LOCALAPPDATA%\Programs\Weft`, a Start menu and desktop shortcut, and `weft://` registered (`build.protocols`).
   Uninstalling keeps `~/.weft` (`deleteAppDataOnUninstall: false`).

## Building (`pnpm dist:win`)

`scripts/dist-win.mjs`, on Windows: the same steps as `dist:linux`, in Node instead of one sh line, since
`package.json` scripts run in cmd.exe there.

| Step | Windows difference |
| --- | --- |
| `next build` (standalone) | `next.config.ts` traces `@anthropic-ai/claude-agent-sdk-win32-x64` |
| `scripts/prepare-standalone.mjs` | the SDK's binary is `claude.exe`; size printed by `scripts/dir-size.mjs` (no `du`) |
| `scripts/bundle-toolchain.mjs` | whisper.cpp (see Dictation); `.cmd` wrappers (`scripts/toolchain-wrappers.mjs`) that run `Weft.exe` with `ELECTRON_RUN_AS_NODE`, like VS Code's `code.cmd`; gog's `windows_amd64.zip`, sha256-pinned; Windows' own `tar.exe` (Git's GNU tar reads `C:\…` as a remote host); `npm.cmd` through a shell |
| `scripts/electron-runtime-deps.mjs --write` | node-pty's prebuild is `prebuilds/${platform}-${arch}` (`win32-x64` holds conpty) |
| `electron-builder --win --${process.arch}` | `build.win` + `build.nsis`; `win.publish` (generic, `releases/latest/download`) makes it write `latest.yml` and the installer's `.blockmap`; for arm64 `dist-win.mjs` renames `dist/latest.yml` to `latest-arm64.yml` |

The arm64 build runs natively on a `windows-11-arm` runner, so `claude.exe`, node-pty, gog and whisper are the arm64
builds (the Agent SDK's and node-pty's packages for the runner's arch are the ones installed).

## Releasing (`.github/workflows/windows.yml`)

A matrix job (free: the repo is public) builds x64 on `windows-latest` and arm64 on `windows-11-arm`, with
`fail-fast: false` so one arch failing still ships the other. Each leg builds its installer, checks the unpacked app
(`verify-packaged-app`, then `node.cmd`, `pnpm.cmd`, `claude.cmd`, `gog.cmd --version` and `whisper-cli.exe --help`
from the toolchain), keeps it as a run artifact (`weft-windows-x64`, `weft-windows-arm64`) and, with a tag, uploads
`Weft-Setup-X.Y.Z-<arch>.exe`, its `.blockmap` and its feed (`latest.yml` or `latest-arm64.yml`) to that release with
`gh release upload`.
It starts three ways:

- **a published release**: the `/release` skill's `gh release create` (the user's token) fires `release: published`;
- **release.yml's `windows` job**, after its `mac` job publishes (a release made with `GITHUB_TOKEN` fires no workflow).
  It `needs: mac` and only adds assets, so a Windows failure never holds the Mac release back; the skill cancels
  release.yml's run, and that cancels this job too, which is why the release event exists;
- **by hand** (`workflow_dispatch`, no tag) or **a push to `ci/windows`**: it builds only, and the installer stays an artifact.

Package scripts run in Git's bash on the runner (`pnpm config set script-shell`): `postinstall` is sh.

## Updating (`electron/updater-win.cjs`)

`electron/updater.cjs` keeps one flow on both platforms (check at launch + 30s and every 4 hours, download in the
background, **Restart to Update**, install on its own once nothing runs and nobody has touched the PC for 10 minutes).
On Windows `windowsUpdaterOptions()` swaps two pieces:

- **the feed** is `releases/latest/download/latest.yml` on x64 and `latest-arm64.yml` on arm64 (`feedFor(process.arch)`),
  read by `fetchLatestYml()` into update.json's shape. The dmg's update.json is published first and the installers
  minutes later; reading the feed means a Windows Weft sees a release only once its installer is up (before that the
  check 404s and says nothing).
- **the updater** is electron-updater's `NsisUpdater` dressed as Squirrel (`squirrelShaped()`): a generic provider on
  the feed's folder (`setFeedURL({provider: "generic", url, channel})`, the feed's name as the channel, so each arch
  reads its own yml; `nsis.channel` would also allow downgrades), `autoDownload`, full downloads (`disableDifferentialDownload`: `latest/download` holds only the
  new blockmap), `update-not-available` turned into an error (which falls back to **Download Weft X…**), and
  `quitAndInstall(true, true)`: a silent `/S` install, then the new Weft starts.

Unsigned updates install: electron-updater checks an update's Authenticode signature only against a `publisherName`
in `app-update.yml`, and Weft sets none. An updater-run install doesn't show SmartScreen (the file is downloaded by
Weft, not a browser, so it carries no Mark of the Web). macOS still uses Squirrel.Mac and update.json, untouched.

## Running (`lib/win-command.ts`)

| POSIX habit | Windows |
| --- | --- |
| `fixPath()` asks the login shell for PATH (`electron/env.cjs`) | skipped: an app Windows starts already has the user's PATH |
| PATH split on `:` (`appendToolchain`) | `path.delimiter` (`;`), so `C:\…` entries stay whole |
| `/usr/bin/which` (`lib/cli-path.ts` for codex, puku-cli, goose; `whichBin` in `lib/cli-exec.ts` for gog, login; `which()` in `lib/transcribe.ts` for whisper and ffmpeg, which is optional here) | `findOnWindowsPath()`: PATH × PATHEXT |
| spawn the CLI as it is | an npm `.cmd` shim (`%APPDATA%\npm\codex.cmd`) goes through `cmd.exe /d /s /c` with each argument quoted and escaped (`spawnPlan()`, as cross-spawn does) |
| a process group, `process.kill(-pgid)` (`lib/cli-process.ts`) | `taskkill /pid N /T /F` (`killTree()`); no `detached` |
| `$SHELL -c` for `!cmd` (`lib/shell.ts`) | `cmd.exe /d /s /c` (`shellPlan()`) |
| the in-app Claude sign-in runs `claude` | `claude.exe` (`electron/claude-sign-in.cjs`) |

Claude Code threads need none of the lookups: the Agent SDK finds its own `claude.exe` in the server bundle.

## Dictation

Same flow as docs/architecture/dictation.md, with three Windows pieces:

- **whisper.cpp ships inside.** `installWhisper()` in `scripts/bundle-toolchain.mjs` (Windows only) downloads whisper.cpp's
  official CPU build from release tag `WHISPER_TAG = "b5454"` (the vX.Y.Z tags lately carry no binaries):
  `whisper-bin-x64.zip` or `whisper-bin-win-cpu-arm64.zip`, sha256-pinned. It keeps `whisper-cli.exe`,
  `whisper-server.exe` and the DLLs (ggml*, whisper, libomp on arm64; not llama, parakeet or SDL2) in
  `toolchain/whisper/`, and `electron/main.cjs` appends `resources/toolchain/whisper` to the end of PATH when packaged.
- **No ffmpeg needed.** `lib/wav-encode.ts`: `sendsWav()` (the user agent says "Windows"), `toWhisperWav(blob)` decodes
  the MediaRecorder webm and resamples to 16 kHz mono in an `OfflineAudioContext`, `encodeWav()` writes 16-bit PCM.
  `lib/use-dictation.ts` sends that WAV on Windows; `lib/transcribe.ts` writes a `wav` upload straight to audio.wav
  (on any OS) and skips ffmpeg. A non-wav upload without ffmpeg throws "Dictation needs ffmpeg to read a <ext>
  recording". A denied mic says "Allow it in Settings → Privacy & security → Microphone".
- **The model downloads on demand.** Whisper is bundled, the model isn't: `missing()` says to reinstall Weft if whisper
  is missing, and "turn on Advanced in Settings → Dictation to download one" for the model (the ~550 MB
  ggml-large-v3-turbo-q5_0 into `~/.weft/models`, `lib/whisper-model.ts`; the CLI path uses it once present).
- **Paste into other apps** (`electron/dictation-insert.cjs`): after the clipboard write, a hidden
  `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "(New-Object -ComObject WScript.Shell).SendKeys('^v')"`
  (`WIN_PASTE`) sends Ctrl+V. There is no Accessibility grant on Windows, and it can't tell a text box from anything
  else, so it always pastes ("pasted") and falls back to "copied" if PowerShell fails. A Weft field still gets
  `insertText`. PowerShell's startup adds a few hundred ms, and terminals that want Ctrl+Shift+V get nothing pasted
  (the text is on the clipboard).

The global hotkey and pill (`electron/dictation-helper.cjs`) are cross-platform Electron APIs, not yet tried on a real
Windows PC.

### Known gaps

- Claude sign-in hands the browser URL to a `#!/bin/sh` helper (`BROWSER`); on Windows Claude Code opens the browser
  itself, so sign in from a terminal with `claude setup-token` if the in-app button stalls.
- Login in Terminal (`lib/login-terminal.ts`, osascript), worktree dependency cloning (`/bin/cp -c`), the simulators and Open In (`open -a`) are macOS-only.
- The folder and git guards list POSIX system folders and `/tmp`; Windows' own aren't on them yet.
- Tested on CI (build, packaged toolchain); a full card on a real Windows PC is the next check.
