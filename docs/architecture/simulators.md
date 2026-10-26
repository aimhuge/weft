# Simulators

Threads drive iOS simulators and Android emulators with the `mcp__simulator__*` tools, and the user
watches the device live in the browser pane, the way they watch a web page.

## Why direct calls, not a wrapped MCP

Two open-source servers do this already:

- **mobile-mcp** (mobile-next): iOS and Android, started with `npx @mobilenext/mobile-mcp`, built on its own
  `mobilecli` binary. Wrapping it would mean a second MCP process per thread, an npm download at run time, and a
  stdio bridge for Codex, which only reaches Weft's servers over HTTP (`lib/mcp-bridge.ts`).
- **XcodeBuildMCP**: iOS only, and much bigger (build, test, project tools), with UI automation through **AXe**.

What both end up calling is small: `xcrun simctl` (ships with Xcode), `adb` and `emulator` (ship with the
Android SDK) and, for taps and the accessibility tree on iOS, AXe (one Homebrew binary). So Weft calls those
directly from an in-process server like the browser's. No new npm dependency, the same server serves Claude
Code, puku-cli and Codex, and every call is `execFile` with an argument list (no shell), so nothing a thread
passes gets parsed twice on the Mac. The one place a device shell parses again is `adb shell`; those
arguments go through `shellQuote()`.

## Pieces

| Piece | Where |
| --- | --- |
| Finding and running the CLIs | `lib/simulator-exec.ts`: `bins()` (xcrun, axe, adb, emulator: Homebrew and SDK folders by name, then PATH), `androidSdk()` (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, `~/Library/Android/sdk`), `run()` / `runText()`, `MISSING` (the fix a tool error names), `XCODE_APP` / `STUDIO_APP` (where the apps live) |
| Whole-device actions | `lib/simulator-devices.ts`: `listDevices()`, `pickDevice()`, `boot()`, `install()`, `launch()`, `openUrl()`, `screenshot()`, `logs()` |
| Screen and touches | `lib/simulator-ui.ts`: `uiTree()` (AXe `describe-ui` JSON, uiautomator XML), `findElement()`, `tapAt()`, `swipe()`, `directionSwipe()`, `typeText()`, `press()` |
| Live view | `lib/simulator-watch.ts`: `watch()`, `writeFrame()`, `viewerHtml()`, `stopWatching()` |
| Setup checks + Install | `lib/simulator-status.ts` (the rows), `lib/simulator-install.ts` + `lib/simulator-install-steps.ts` (the jobs), `app/api/connectors/simulators/install/route.ts`, `components/SimulatorConnector.tsx` |
| Tools + prompt | `lib/simulator-tools.ts`: `simulatorMcpServer()`, `SIMULATOR_PROMPT` (pinned in `lib/weft-prompts.ts`) |
| Wiring | `lib/weft-mcp.ts`: `simulator` for threads, not the copilot; Codex gets it through the bridge |
| Settings | `lib/simulator-status.ts` (types in `lib/simulator-view.ts`) → `app/api/connectors/simulators/route.ts` → `components/SimulatorConnector.tsx` on Settings → Connectors |

## The tools

| Tool | iOS | Android |
| --- | --- | --- |
| `list_devices` | `simctl list devices available -j` | `adb devices`, `adb emu avd name`, `emulator -list-avds` |
| `boot` | `simctl boot`, `simctl bootstatus -b`, then opens Simulator.app on it | `emulator -avd <name>` (detached), polls `getprop sys.boot_completed` |
| `install` | `simctl install <udid> <.app>` | `adb install -r <.apk>` |
| `launch` | `simctl launch <udid> <bundle id>` | `monkey -p <package> -c LAUNCHER 1` |
| `open_url` | `simctl openurl` | `am start -a VIEW -d <url>`; a localhost URL gets `adb reverse tcp:<port>` first |
| `ui_tree` | `axe describe-ui` | `uiautomator dump /dev/tty` |
| `tap`, `swipe`, `type_text`, `press` | `axe tap / swipe / type / key / button` | `input tap / swipe / text / keyevent` |
| `screenshot` | `simctl io screenshot` to a temp file | `exec-out screencap -p` |
| `logs` | `simctl spawn log show --last <since>` (a process/subsystem predicate for one app) | `logcat -d -t <n>` (`--pid` of one package) |
| `watch` | live view in the pane | same |

A device is named by its id (udid, adb serial, or `avd:<name>` for an AVD that isn't running) or its name;
with none named, the tools use the one booted device and say so when there are several.

**By element first.** `ui_tree` prints each labelled element as `[index] Type "label" #id (x,y wxh)`. `tap` and
`type_text` take an element by its index, id, exact label, then a label that contains the words, and tap its
centre. A frame is in the units that platform's taps take (iOS points, Android pixels), so the centre needs no
conversion. Coordinates stay as a fallback; the screenshot's text says which units they're in.

**Screenshots.** The image a thread sees is shrunk to 1000 px tall (a 2556 px iPhone shot costs a lot of
context for nothing); `save_to` writes the full-size PNG, like the browser's.

## Watching

`watch` writes `~/.weft/show/simulator/<device>/index.html` and starts a loop that rewrites `frame.jpg` beside it
(420 px wide, from the device's screenshot) every second for 10 minutes. Each frame goes to a temp file and is
renamed in, so the page never loads half a JPEG; the next capture waits for the last, so a slow device never
piles them up. The page reloads `frame.jpg?<time>` after each load and says "paused" when its time is up; calling
`watch` again extends it. Tool calls that change the screen (tap, type, swipe, open_url, launch) write a frame at
once while a watch runs, so the pane doesn't lag a second behind.

The page is a plain show page: `watch` opens it in the card's pane (`openInPane`), the show rail records it as a
page the pane showed, and `lib/page-shots.ts` takes its picture for the rail like any other.

## Setup

Settings → Connectors → **Simulators** checks what's there, and its **Install** buttons set up what isn't:

- iOS: Xcode.app, `xcode-select -p` pointing into Xcode (not the CommandLineTools), an iOS runtime
  (`simctl list runtimes -j`), AXe.
- Android: Android Studio.app, the SDK folder, adb, the emulator, at least one AVD.

Each missing piece shows its fix: an **Install** button, or a link for the two big apps (Xcode from the App Store,
Android Studio from developer.android.com/studio). Install runs on Weft's server, one job per fix
(`lib/simulator-install.ts`: `startInstall()`, `installJobs()`, `runStep()` with no shell, `download()` pinned by
sha256), and the panel polls `GET /api/connectors/simulators/install` for the job's last line of output, then looks
again when it ends. What each one runs (`lib/simulator-install-steps.ts`):

| Install | Runs |
| --- | --- |
| `xcode-select` | `osascript … xcode-select -s /Applications/Xcode.app/Contents/Developer with administrator privileges` (the macOS password prompt) |
| `runtime` | `xcodebuild -downloadPlatform iOS` (~8.5 GB) |
| `axe` | AXe's GitHub release (the build Homebrew's formula pins) unpacked to `~/.weft/tools/axe` and signed ad hoc. No Homebrew: brew refuses any formula while the Command Line Tools are older than macOS, which is common |
| `android` | Google's command-line tools into `~/Library/Android/sdk/cmdline-tools/latest`, then `sdkmanager --licenses` (clicking Install is the yes), platform-tools, the emulator, `platforms;android-36` and a Play arm64 image, and `avdmanager create avd` for `Weft_Pixel_9`. Runs on Android Studio's bundled Java (`Contents/jbr`), so Studio has to be there first; every Android row shares this one Install |

The tools' own errors name the same fixes (`MISSING` in `lib/simulator-exec.ts`), and `SIMULATOR_PROMPT` tells
threads to point the user at Install and ask before installing any of it themselves.

## Next

- Build an app for the simulator (`xcodebuild -sdk iphonesimulator`, `./gradlew assembleDebug`) as a tool, not Bash.
- A video recording of a run for the review tour (`simctl io recordVideo`, `adb screenrecord`).
- Real devices over USB (`devicectl`, adb already works with one plugged in and authorized).
- Clicking in the live view to tap the device.
