# The welcome tour

The welcome's first screen (Get ready) plays a narrated 78-second tour of Weft, built from three
[HyperFrames](https://hyperframes.heygen.com) compositions. The same pages render to MP4s for weft.zip.

## Pages (`public/welcome/`)

| Page | Length | What it shows |
|---|---|---|
| `intro.html` | 12 s | "Welcome to Weft", the future of AI engineering, the agents it runs on (Claude Code, Codex, Puku AI) |
| `loop.html` | 30 s | One card from prompt to Done: you click the card, its thread works while the pane shows the plan and the app, a question in Needs you, the 🔐 vault's Touch ID prompt, Review, Done |
| `beats.html` | 36 s | Connect your tools, a pane as a shared live dashboard, the Wefter Profile, code quality and the refactor scout, "Now let's get started" |

Each page is plain HTML plus a paused GSAP timeline on `window.__timelines.root`; the renderer seeks it frame by
frame, so nothing uses timers. Backgrounds are Weft's own scenes (`bg-*.jpg`, from `electron/assets`), the icon is
`icon.png` (a copy of `public/app-icon.png`), and `gsap.min.js` is vendored.

## Playing live (`components/WelcomeLoop.tsx`)

- `lib/welcome-loop.ts` builds the first page's address (`?live=1&tour=1&p=<your projects>`), names the beats and
  maps each page to its voice track (`voiceFor`, `stepVoice`).
- `public/welcome/live.js` (`window.weftLive`) scales the stage to the frame, posts `{ weft: "welcome", beat }` to the
  parent as the timeline passes each beat, and hands off intro → loop → beats → intro with `location.replace`.
- `lib/use-welcome-tour.ts` listens (only to its own iframe), starts the page's voiceover through
  `lib/welcome-voice.ts` (`VoicePlayer`: one track at a time), and posts `{ weft: "who", name, avatar }` back so the
  profile beat shows you once you're signed in. During the profile beat a real **Sign in with GitHub** button sits
  over the frame while you're signed out. `useStepVoice` says "Allow Weft to see your projects." and "Now start a new
  thread." as those steps open, unless muted.
- Narration is on by default; the 🔊 button mutes it, kept in localStorage (`weft-welcome-muted`). Reduced motion
  shows the still board screenshot instead. The iframe is `sandbox="allow-scripts"` and can't be focused.

## Voice and music (`scripts/narrate-welcome.mjs`)

`pnpm welcome:narrate` voices every caption with Kokoro (`kokoro-js`, local, `af_heart` at 1.1×; installed in
`~/.cache/weft-kokoro`, outside the repo), places each clip at its cue with ffmpeg, mixes a soft Am-F-C-G pad
under it (generated from sine waves, about 10 dB under the voice), and writes `narration-<page>.m4a`. It warns when a
line runs past its beat. Spell tricky words for the voice ("see-ell-eyes" for CLIs) and check with whisper-cli.

## Rendering (`scripts/render-welcome-loop.mjs`)

`pnpm welcome:render` renders each page with `hyperframes render` (pinned version), copies only assets and the one
page into a temp folder (HyperFrames treats every root HTML file as an entry point), and writes
`public/brand/welcome-loop.mp4` (the loop) and `public/brand/weft-tour.mp4` (intro + loop + beats, joined with ffmpeg's
concat demuxer without re-encoding). Needs ffmpeg. After changing a caption, run `welcome:narrate` first.

## Editing

Captions live in the HTML and the voice in `NARRATION` (`scripts/narrate-welcome.mjs`); change both. Lines that run
past their beat keep the stage's timing honest, so move the beat's cues in the HTML to match.
