# The welcome tour

The welcome's first screen (Get ready) plays a narrated 107-second tour of Weft, built from three
[HyperFrames](https://hyperframes.heygen.com) compositions. The same pages render to MP4s for weft.zip.
The per-drawer intros ([feature-intros.md](feature-intros.md)) are the same idea at one feature each, and share
this tooling: `scripts/narrate-lib.mjs` (Kokoro plus the pad), `lib/welcome-voice.ts` (`VoicePlayer`, and the one
mute key both read and write) and the live-frame conventions (`?live=1`, the parent `postMessage` handshake).

This is the tour *inside* the welcome. The dialog around it — the steps, the replay, how it closes — is
[welcome-dialog.md](welcome-dialog.md).

## Pages (`public/welcome/`)

| Page | Length | What it shows |
|---|---|---|
| `intro.html` | 12 s | "Welcome to Weft", the future of AI engineering, the agents it runs on (Claude Code, Codex, Puku AI) |
| `loop.html` | 26.4 s | One card from prompt to Done: you click the card and its thread opens, every card has a pane (the plan, then the app), a question in Needs you, Review, Done |
| `beats.html` | 68.4 s | Connect your tools, the 🔐 vault (Touch ID fills in a key the thread never sees), a pane as a shared live dashboard, code quality and the refactor scout, BlastCP built in (your socials, image, video and voice for a launch post), the Wefter Profile, Weft is open source (make a pull request), and Weft is driven by keyboard shortcuts: double-click the board or ⌘N for New thread, Esc closes it, ⌘K opens the search and action HUD, ? lists the shortcuts |

Each page is plain HTML plus a paused GSAP timeline on `window.__timelines.root`; the renderer seeks it frame by
frame, so nothing uses timers. `beats.html` draws each scene from its start time and lists them in `SCENES`, so the
order (build → ship → show) lives in one place. A scene that speaks several lines (the keyboard one) gives each
caption its own `data-scene`, its line's cue, so `live.js` lights it with that line; keep it in step with `BEATS` in `lib/welcome-loop.ts` and the cues in
`NARRATION`. Backgrounds are Weft's own scenes (`bg-*.jpg`, from `electron/assets`), the icon is
`icon.png` (a copy of `public/app-icon.png`), and `gsap.min.js` is vendored.

## Playing live (`components/WelcomeLoop.tsx`)

- `lib/welcome-loop.ts` builds the first page's address (`?live=1&tour=1&p=<your projects>`), lists the beats in order
  with their titles and pages (`BEATS`, `BEAT_TITLES`, `pageOf`), and maps each page to its voice track (`voiceFor`,
  `pageVoice`, `stepVoice`).
- `public/welcome/live.js` (`window.weftLive`) scales the stage to the frame, posts `{ weft: "welcome", beat, t, jumped }`
  to the parent as the timeline passes each beat, and hands off intro → loop → beats → intro with `location.replace`.
  It takes `{ weft: "go", beat, page }` from the parent: a beat on its page is a seek, one on another page loads that
  page with the beat as its `#hash`, which it seeks to as it starts.
- `components/WelcomeTourBar.tsx` is the strip under the frame: "3 of 10 · Connect your tools", a segment per beat to jump
  to, **‹ Back** and **Next ›** a beat at a time (not the whole tour) and the 🔊 mute. A jump comes back with
  `jumped: true` and the page's time, and the voiceover restarts there (`VoicePlayer.play(src, at)`).
- `lib/use-welcome-tour.ts` listens (only to its own iframe), starts the page's voiceover through
  `lib/welcome-voice.ts` (`VoicePlayer`: one track at a time), and posts `{ weft: "who", name, avatar }` back so the
  profile beat shows you once you're signed in. During the profile beat a real **Sign in with GitHub** button sits
  over the frame while you're signed out. `useStepVoice` says "Allow Weft to see your projects." and "Now start a new
  thread." as those steps open, unless muted.
- Narration is on by default; the bar's 🔊 button mutes it, kept in localStorage (`weft-welcome-muted`). Reduced motion
  shows the still board screenshot instead. The iframe is `sandbox="allow-scripts"` and can't be focused.

## Voice and music (`scripts/narrate-welcome.mjs`)

`pnpm welcome:narrate` voices every caption with Kokoro (`kokoro-js`, local, `af_heart` at 1.1×; installed in
`~/.cache/weft-kokoro`, outside the repo), places each clip at its cue with ffmpeg, mixes a soft Am-F-C-G pad
under it (generated from sine waves, about 10 dB under the voice), and writes `narration-<page>.m4a`. `-- --only=beats` voices one track, so the others aren't re-encoded. It warns when a
line runs past its beat. Spell tricky words for the voice ("see-ell-eyes" for CLIs; "APIs" in capitals, since lowercase "apis" reads "uh-peez") and check the phonemes, not just whisper-cli, which tidies acronyms up: `phonemize()` from the `phonemizer` package in `~/.cache/weft-kokoro`.
`scripts/narrate-lib.mjs` is the shared half (Kokoro, the pad, `--voice=`), used the same way by
`pnpm intros:narrate` ([feature-intros.md](feature-intros.md)).

## Rendering (`scripts/render-welcome-loop.mjs`)

`pnpm welcome:render` renders each page with `hyperframes render` (pinned version), copies only assets and the one
page into a temp folder (HyperFrames treats every root HTML file as an entry point), and writes
`public/brand/welcome-loop.mp4` (the loop) and `public/brand/weft-tour.mp4`, weft.zip's homepage video: intro + loop +
beats cut where its keyboard shortcuts start (`keysStart` reads the cut from beats.html's `SCENES`, faded over 0.6 s) +
`outro.html`, re-encoded as one MP4. Shortcuts only help once Weft is installed, so the homepage ends on downloading it
instead: `outro.html` (13 s, voice `narration-outro.m4a`) shows Weft in a Mac window with an agent on each card ("Weft
runs right on your Mac, with the AI you already use."), the cursor clicking Download for Mac and the icon landing in the
dock ("Download Weft, and engineer the future with us."), then the end card it holds on ("Weft. Engineering the
future."). The in-app welcome never loads it. Needs ffmpeg. After changing a caption, run `welcome:narrate` first.

## Editing

Captions live in the HTML and the voice in `NARRATION` (`scripts/narrate-welcome.mjs`); change both. Lines that run
past their beat keep the stage's timing honest, so move the beat's cues in the HTML to match.
