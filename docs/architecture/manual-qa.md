# Local Simulator mode (was Manual QA)

An agent fixing things alone uses the device on the worker. A person testing by hand wants the device on their own Mac, because a
local simulator has no tap latency and already has the [30 fps live view](simulators.md#live-view). Local Simulator mode gives them that:
the worker builds, the app runs on the Mac, and the worker's agent keeps driving it. Both modes stay, and this one is per card.

```
worker: xcodebuild / gradle
  │ mcp__simulator__install(path)              lib/worker-device.ts packs it: ditto zip of the .app, or the .apk as it is
  │ POST weft.zip/api/worker-build  Bearer wwk_…     presigned PUT, qa-builds/<org>/<worker>/<sha>
  ▼
R2 (private, expires after a day)
  │ worker_device_call → public.device_calls   a row addressed to the Mac; args carry { build: sha, kind, bytes }, no URL, no path
  ▼
Mac: lib/cloud-inbox.ts hears it → lib/device-calls.ts
  │ requireGrant(card, worker)                 lib/qa-grants.ts; refused without the switch's Touch ID
  │ GET /api/worker-build?call=  Bearer session     checks the call is yours, answers a presigned GET
  │ lib/device-build.ts                        hash checked, zip names checked, links checked
  ▼
simctl / adb install on the device you picked ─▶ the answer goes in the row ─▶ the tool that's waiting returns it
```

Your own taps go through the normal live view (`lib/simulator-input.ts`) and never touch the cloud.

## The switch

**Local Simulator** sits in a worker card's pane toolbar on the desktop board (`components/QaSwitch.tsx`), and needs no extra row. It lists
this Mac's devices, and picking one goes `POST /api/worker-board` `{ action: "qa" }`, which is `elevated`, so a thread's curl can't reach
it. `lib/qa-switch.ts` asks Electron main (`POST /qa/approve`, Touch ID, naming the worker, project and device), keeps the grant, then
sends a `qa` command. The worker writes `card.qaDevice`, the Mac's sync device id, and that comes back on the card's row. With it set and
a grant here, `WorkerOpenCard` draws the native `BrowserPane` in place of `WebPane`, because that's the pane with the window capture.
The board's existing `setActive(selectedId)` already points it at the card.

weft.zip and the phone have no switch: the yes has to be given on the machine the build runs on.

## Security

**A simulator app runs as a macOS process with your permissions.** An iOS simulator app isn't kept out of `~/.ssh` or `~/.weft`, and it
shares the Mac's network, so running a worker's build is running code as you. An Android emulator is a VM and contains a bad app far better.

**The yes covers one card, one worker and one device, for 8 hours.** That's the user's decision (2026-10-31). Every build from that card
in that window runs with no further prompt, so a compromised worker, or a repo that card pulled, can use the window. The grant is held
in memory on the Mac (`lib/qa-grants.ts`): a restarted Weft forgets it. When it lapses the Mac refuses, and the agent is told to ask you.

**The worker's word buys nothing.** `qa` and `card.qaDevice` are routing. A worker with no grant gets a refusal, however it was told to
send. The agent has no tool that turns this on.

**A call is untrusted input** (`lib/device-call.ts`, `lib/device-calls.ts`):

- The tool has to be on the list, and only known fields survive, each the right type.
- The device comes from the grant, never the row. `list_devices` shows only that device.
- `install` takes a hash. The Mac never reads a URL or a path off a row.
- The hash is checked by the Mac, because a presigned PUT can't prove its bytes match the name.
- A zip with `..`, an absolute path or a link leaving the folder is refused, and so is anything but one `.app`.
- `open_url` to the Mac's localhost is refused, which also keeps Android's `adb reverse` out of a worker's reach.
- Crash reports cover every process on the Mac, so only a report naming this device goes back, cut to the exception and the
  faulting thread (`lib/simulator-crashes.ts`).

**Not covered.** A build approved here can do anything you can. Nothing here sandboxes it. The simulator tools are trusted in every
permission mode ([modes](weft-worker.md#the-live-screen)) because they reach a sandboxed device; in this mode that isn't true of iOS, and the
8 hour grant is what stands in for the prompt.

## Moving the binary

Builds use R2, not `weft-blobs`. In `weft-blobs` any workspace member can download a build, nothing deletes it, and every object is
mirrored. The bucket sets no size limit of its own, so the project's limit applies, and a build can pass Supabase's 50 MB default. On R2
the key is private to the route, egress is free, and the object expires.

- **Cap:** 500 MB, checked by the worker, the route and the Mac's download. A presigned PUT can't enforce it, so the Mac's check is the real one.
- **Size:** a release `.app` zips to tens of MB. An Android build carrying every ABI is far bigger, so build one (`reactNativeArchitectures=arm64-v8a`).
- **Expiry:** an R2 lifecycle rule on the `qa-builds/` prefix, one day. It's set in Cloudflare, not in this repo.
- **On the Mac:** `DATA_DIR/qa-builds`, mode 700, swept of anything over a day old on each install.
- **Architecture:** a build has to match the Mac: an Apple Silicon worker and an Apple Silicon Mac are fine. Linux can't build iOS.

## Metro

A bundled build, not a tunnel. The device on the Mac can't reach Metro on the worker, and [worker tunnels](weft-worker.md#the-live-screen) are
a six-part project that isn't built. A bundled build puts the JS inside the binary, so nothing on the Mac depends on the worker staying
reachable. For Expo 54 and RN 0.81 (Ling): `npx expo prebuild`, then
`xcodebuild -configuration Release -sdk iphonesimulator -derivedDataPath build` or `./gradlew assembleRelease`. `SIMULATOR_PROMPT` tells
threads this.

The cost is no hot reload: each JS change is a rebuild and a reinstall. A later step could send just the JS bundle to a local server on the Mac.

## Reverse calls

`public.device_calls`, not `cloud_commands`
(`supabase/migrations/20261031162214_device_calls.sql`). Every member reads `cloud_commands`, these rows carry screenshots and logs, and
a worker must not gain a way to write into the table a Mac obeys: a row there would read as made by you.

- **Writes:** only `worker_device_call`, key-checked. The card has to be the worker's, and the Mac one of its account's desktops with a beat in the last
  minute. RLS lets the owner read and answer, and no client can insert.
- **The Mac** listens on the inbox's channel and drains on its 30 s check, one call at a time, oldest first, apart from the inbox's own drain.
- **The worker** polls `worker_device_result` every 250 ms. An answered row is deleted as it's read. Leftovers go after an hour.
- **Sizes:** arguments under 64 KB, a result under 4 MB. A screenshot comes back at 1000 px tall, so `save_to` on a worker writes that size.

## When the Mac isn't there

```
no beat for a minute, or nobody claims in 20 s ─▶ the call is taken back ─▶ runs on the worker's device, and says so
the Mac refuses (no grant, 8 hours up)         ─▶ the agent reads the refusal; nothing runs on the worker
claimed, no answer in 90 s (6 min for install) ─▶ an error saying it may have run; nothing runs on the worker
```

`worker_device_cancel` only removes a row that's still pending, so a Mac that wakes can't run a stale tap. The next call tries the Mac
again. The worker's device may not have the app, and the note says so.

## Crashes

`logs` reads the device's log, which misses an iOS crash: the report lands on the Mac in `~/Library/Logs/DiagnosticReports`. A worker's
`logs` call adds recent reports (15 minutes, at most three) for that device and app, and on Android the crash buffer (`logcat -b crash`).

## Events from the device

Today the agent only learns what a tool call asks for. When you tap through the app by hand, the agent sees none of it until it calls
`logs` or `screenshot`. The planned fix is part of the WebRTC work ([the fast path](weft-worker.md#the-fast-path), `lib/worker-rtc.ts`): a
named channel from the Mac to the worker that streams what happens on the local device. Not built.

- **Which line:** the board on the Mac is already one end of that peer connection, so this is a new channel on it, in the opposite
  direction to the screen stream.
- **What stays on `device_calls`:** tool calls. Their answers have to arrive with no board open, and the line only exists while someone
  is watching. Events are best-effort, so a dropped line loses them and the agent can still ask with `logs`.
- **The same limits apply.** Events come only from the granted device, only during the grant, and a Mac crash report goes through the
  same filter as `lib/simulator-crashes.ts`. A log line can hold what the app was given, so this widens what reaches the worker.

## Not yet

- A worker's Codex and Goose cards: their tools reach Weft over a local server a worker doesn't run ([pages](weft-worker.md#pages-from-a-worker)).
- Real devices, and a bundle-only update for a JS change.
- Full-size `save_to` from the Mac.
