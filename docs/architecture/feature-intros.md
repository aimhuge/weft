# Feature intros

Every tool drawer on the left rail, the New thread dialog, the code quality dialog and the leagues have a short
narrated video that plays when you press ▶ beside the title (never on its own): what the drawer is for and what it can do. Fourteen of them, each its own
page in `public/intros/`. This is the same HyperFrames idea as the welcome tour (see [welcome-tour.md](welcome-tour.md)),
scaled down to one feature instead of the whole product.

## Key files

| File | What it is |
|---|---|
| `public/intros/<id>.html` | One composition per intro: plain HTML plus a paused GSAP timeline handed to `window.weftIntro(tl)`, drawn with the shared `kit.css`. The page's own `.head` row (the drawer's icon and name) is what the splash reads. |
| `public/intros/player.js` | The live player and the splash: `buildSplash()` injects the poster, `readFeature()` reads the feature out of the page's `.head` row, `FEATURE_TAGS` holds the one line under the name and `FEATURE_MARKS` overrides the mark for Vercel and code quality. |
| `public/intros/splash-timing.js` | The splash's timing in one place (`hold`, `fade`, `lead`): the page plays it with, and the renderer, encoder and verifier read it, so the poster's length can't drift away from the voice's delay or the video's length. |
| `public/intros/kit.css` | The shared look: the 16:9 1600×900 stage, the caption, the chip row, the `#splash` block (the poster's layout and scale, the halo, the ground gradient, the progress bar) and the portrait restack. |
| `scripts/narrate-intros.mjs` | Voices each page's `#narration` block into `<id>.m4a` beside it. |
| `scripts/render-intros.mjs` | Captures the frames of one intro with headless Chrome, seeking the paused timeline. |
| `scripts/encode-intros.sh` | Muxes the narration in (delayed by the splash) and loudness-normalises to −16 LUFS. |
| `scripts/verify-intros.sh` | Checks a finished video: duration against the story, an AAC track, the voice starting after the splash, loudness, and that the poster frame pulled out of the video is really the poster. |
| `lib/feature-intros.ts` | The pure half: the id list, the titles, the URL and message helpers, the seen set in `localStorage`. |
| `lib/use-feature-intro.ts` | Decides when one opens and holds its state. `components/FeatureIntro.tsx` draws it. |
| `lib/intro-cover.ts` | The signal a dialog sends as it opens over a playing intro, which pauses it. |

The three render scripts are in the repo so a video can be reproduced: `INTROS_DIR` points at the compositions and
`OUT_DIR` at the frames and the finished videos, so the same scripts run on a machine that has the sources synced but
not the whole repo.

## The pages (`public/intros/`)

One `<id>.html` per intro, listed in `INTROS` in `lib/feature-intros.ts` — that list is the contract; an id
without a page plays a blank frame, and a page not in the list is never shown. `VIDEO_INTROS` is the narrower list
of the ones that actually have a page and a voice. Today every drawer has both (Slack and ⏰ Crons were the last,
2026-10-26), but a new drawer can join `INTROS` with a title before its video is made: the rail knows it, it plays
nothing and the ▶ button stays away until it joins `VIDEO_INTROS`.

Each page is plain HTML plus a paused GSAP timeline handed to `window.weftIntro(tl)`, drawn with the shared
`kit.css` (a 16:9 1600×900 stage: the drawer's art on the left inside `<div class="abs art">`, in the 800-wide
coordinates it was drawn in and clipped there, and the `.head` title and `.cap` captions in the right column, in
type big enough to read in the rail's 272 px drawer) and played by the shared `player.js`. Anything that sits over
the panel (a Touch ID sheet, the cursor) goes inside `.art`; a page's own closing line goes in the right column like
a caption (`#close` in `vault.html`):

| | |
|---|---|
| `player.js` | `window.weftIntro` scales the stage to the frame and, with `?live=1`, plays the timeline once from the top **with its own voice** (the `<id>.m4a` beside the page; `?muted=1` starts it muted, `{ weft: "intro-mute", muted }` flips it). The timeline waits for the voice to really play (or fail, or 4 s), and a voice later than that pulls the frames back to where it is. It posts `{ weft: "intro", event }` as `start` when it starts, `pause` and `play` when it stops and plays on, and `done` when it ends. It takes `{ weft: "intro-go" }` from the parent to start over and `{ weft: "intro-toggle" }` (a click on the video) to pause the frames and the voice together or play both on; a toggle on a finished video starts it over. `?t=<seconds>` holds the frame there instead, for checking a scene by eye. |
| `kit.css` | The shared look: the stage, the caption, the chip row, the splash. |

Like the welcome tour's pages, the timelines use no timers and no `tl.call`, so a frame is drawn purely by
seeking. Captions live in the page and the voice in its `#narration` block (`<script type="application/json"
id="narration">`), so the text and the track change together.

### The splash

Every intro opens on a splash poster **about the feature, not about Weft**: the feature's own icon big in the
middle, its name under it, and a line saying what it's for, on a radial ground with a halo behind the icon. It is
sized like an OG image — a 640 px mark, a 176 px name and a 78 px line in the portrait render, stepping down to
420/138/60 px in the landscape one — so it fills the frame rather than floating in it.

`player.js` injects it, so all the pages open alike without each one carrying the markup. The feature's name and
icon are read out of the page's own `.head` row (`readFeature`): a drawer with artwork brings its SVG, one that uses
a glyph brings its emoji, and the name is the head's text with the glyph taken out of it. Two features get a mark
of the poster's own (`FEATURE_MARKS`): Vercel's own icon is a plain triangle and the code quality ring is drawn at
a fifth of its opacity, so both vanish at poster size — the drawer is unchanged.

The one line under the name is `FEATURE_TAGS` in `player.js`, keyed by the page's file name: what the feature does,
not what Weft is. It has a key for every page, so no poster opens on an empty line.

It holds for 1.5 s and fades over 0.5 s — 2 s of lead before the story. Those three numbers live in
`public/intros/splash-timing.js` (`hold`, `fade`, `lead`), which the page loads and the three render scripts read:
the renderer asks for frames across the lead, the encoder delays the narration by it and the verifier expects the
video to be that much longer than the story. When each file carried its own copy, retiming the splash
silently desynchronised the picture from the voice. It plays on a **master** timeline with the
page's own timeline nested under it (`master.add(tl, lead)`), which keeps the whole composition seekable for the
frame-by-frame render. A nested timeline only advances if it isn't paused itself, so `tl.paused(false)` follows the
`add`; the master is the only paused thing. `?t=` is read on the master's clock: the first 2 s are the splash, so
`?t=0` shows the splash and `?t=2` shows the story two seconds in.

The narration is delayed by the same 2 s when the video is encoded, so the voice starts with the picture instead
of underneath the splash.

### The portrait render

`?ratio=9:16` restacks the landscape stage into a tall 1600×2844 canvas (`html.portrait` in `kit.css`): the drawer
art on top, the title and caption below. `player.js` then scales against 2844 rather than 900, so a vertical video
fills its frame instead of sitting in a black band. The stage is taken out of the flow (`position: fixed`) in
portrait, because a 2844 px canvas would otherwise grow the document and shrink the viewport the stage is scaled
against. The splash is `position: fixed` there too, so it centres on the frame rather than on the taller canvas.

## Narrating (`pnpm intros:narrate`)

`scripts/narrate-intros.mjs` reads every page's `#narration` block and writes `public/intros/<id>.m4a` beside it,
through `narrate` in `scripts/narrate-lib.mjs` (Kokoro, the local text-to-speech model, with the welcome tour's
pad under it — that module is shared with `scripts/narrate-welcome.mjs`).

```sh
pnpm intros:narrate                    # every intro
pnpm intros:narrate -- vault github    # just these
pnpm intros:narrate -- --voice=am_michael
```

A track is optional: an intro with no `.m4a` plays silently and the 🔊 button still shows. A page with no
`#narration` block is skipped with a warning.

## Rendering (`pnpm intros:render`, `pnpm intros:encode`, `pnpm intros:verify`)

The app plays the live composition in its frame, but a shareable video is a render of it: headless Chrome
screenshots the paused timeline once per frame and ffmpeg turns the frames into an mp4. The three steps are three
scripts, so a finished video can always be reproduced.

```sh
pnpm intros:render vault 12 portrait --fresh   # the frames
pnpm intros:encode vault 12 portrait            # the mp4
pnpm intros:verify                              # every video
```

**`scripts/render-intros.mjs`** captures the frames (1080×1920 in portrait, 12 fps) into
`build/intros/frames/<id>-<fps>[-p]`, one headless Chrome screenshot per frame at `?t=<s>`. The page's own
`data-duration` says how long the story is; the splash adds 2 s of lead on top, and the frames are asked for on the
master clock (the splash's seconds directly, the story's seconds offset past the lead).

It is resumable: a frame already on disk is kept, so an interrupted render picks up where it stopped. A frame only
counts as done if it is **readable, recent and not blank**:

- A truncated frame from an interrupted run doesn't count.
- A frame older than `player.js` (the kit's mtime is the marker) was captured against the composition as it was
  before, so it is recaptured.
- A frame **under 30 KB** is blank — the page didn't load, so the capture wrote the background. A real frame is
  well over 30 KB; a blank one is about 10 KB. A blank frame is "present", so without this rule the resume would
  hand back a reel of nothing and call it finished.

**`scripts/encode-intros.sh`** turns the frames into an mp4 (`libx264`, `yuv420p`, CRF 20, `+faststart`). When
`public/intros/<id>.m4a` exists it is muxed in as AAC, delayed by the 2 s of splash so the voice starts with the
story, and loudness-normalised to −16 LUFS (the narrated mix sits near −24 dB, too quiet to hear). Both inputs carry
an explicit `-f`: ffmpeg 8 misreads a codec flag sitting between two inputs as a third input, and the `.m4a`
suffix hides an mp4 container.

**`scripts/verify-intros.sh`** checks each finished video: the right duration (story + splash), an AAC track, the
voice starting after the splash (the first sound in the track, via `silencedetect`), the loudness, and — the check
that catches the failure that looks most like success — that the poster frame pulled out of the finished video is
really the poster. A real splash frame is well over 100 KB; a blank one is about 10 KB.

### The blank-frame trap

A page that doesn't load its GSAP never draws: the capture still writes a file (the background) and ffmpeg encodes
a reel of nothing with the right length and a silent track, so the video looks finished. The pages load GSAP from
`../welcome/gsap.min.js`, so `public/welcome/gsap.min.js` has to be beside the compositions on the machine doing
the render; without it every frame comes out blank.

Three layers keep that from shipping: the renderer recaptures any frame under 30 KB, the verifier measures the
poster frame out of the finished video, and the render job on the rendering machine checks that GSAP is beside the
sources before it starts. See
[bug-fixes/040-intro-renders-came-out-black-when-gsap-was-missing.md](../bug-fixes/040-intro-renders-came-out-black-when-gsap-was-missing.md).

## When it shows (`lib/use-feature-intro.ts`)

`useFeatureIntro(id)` takes the drawer (or dialog) that's open, or `null`, and returns the state
`components/FeatureIntro.tsx` draws:

- It **never opens by itself**: a drawer or dialog opens with its intro shut and ▶ beside its title. It used to open
  the first time each drawer did, voice and all, and a voice starting unasked was unwelcome; the New thread splash's
  tips (`lib/new-thread-tips.ts`) point at the intros instead.
- It's seen once the page plays to the end (`done`) or you hide it, so hiding counts too.
- The page plays its own voice, and stops it when you hide it or the drawer closes (both unmount the frame). The board
  used to start it on `start`, but the sandboxed frame animates in its own process while the board's window can be
  busy for seconds as a drawer opens, so the voice came in that late. The hook shares the welcome tour's 🔊 setting
  (`readMuted`/`writeMuted` in `lib/welcome-voice.ts`, the same localStorage key), so muting one mutes the other:
  in the frame's address when it loads (`introSrc(id, muted)`) and as `muteMessage` when you flip it, so a flip
  doesn't reload the page.
- Messages count only from the intro's own iframe (`e.source === frame.current?.contentWindow`, and only once it has
  one); another frame on the page can't drive it.
- It plays **big first**: a modal three quarters of the window (`min(75vw, 75vh × 16/9)` wide, 16:9) over a dimmed backdrop. ✕, Esc or the backdrop shrink it back into its drawer or dialog, where it **plays on** at the full width of that space; ⤢ there blows it up again, and ✕ there hides it. It is one iframe in one box whose styles switch between `fixed` and in-flow (`expanded`, `setExpanded`), so it is never moved in the DOM and never reloads. That only works because nothing above it makes a containing block for `fixed`: the rail drawer slides its body in by `margin-left`, not a transform (`components/rail-drawer.css`), and `Modal` uses none. Esc goes through `useEscape` (`lib/use-escape.ts`), so it shrinks the intro before the drawer or dialog under it reads it. While it is big, `lib/intro-modal.ts` tells `lib/use-board-dialogs.ts` an overlay is up, so the native browser pane hides under it.
- A click anywhere on the video pauses it (▶ shows over it) and plays it on (`togglePlaying` → `TOGGLE_MESSAGE`); the page answers `pause`/`play`, which is what `paused` follows.
- Something coming over a playing intro pauses it the same way, until you click it: every `Modal` as it opens (the achievement popup among them) and the New thread dialog (`lib/use-board-dialogs.ts`, as it isn't a Modal) call `coverIntros()` (`lib/intro-cover.ts`), and an intro the page says is playing posts `PAUSE_MESSAGE` (`{ weft: "intro-pause" }`), which `player.js` ignores when it is already paused or finished. It's a signal, not a flag: the dialog an intro plays in opens before its page starts, so it never pauses its own intro. The New thread intro that plays in the native pane isn't covered by this: nothing in the DOM can sit over the pane.
- ▶ beside the title plays it again, big: an open intro is asked to start over, a closed one is loaded fresh (a new
  `run` remounts the iframe). ↻ Replay appears over the frame once it ends.

## New thread plays in the browser pane, on ▶ only (`lib/pane-intro.ts`)

The New thread intro is a minute of tips, and one of them is about the browser pane, so on the desktop it plays
there, beside the dialog, at full size rather than in a frame over the composer. It **never starts on its own**: it
used to play in place of the splash the first time the dialog opened, and later the next unseen drawer intro each
time, but a voice starting unasked while you write a prompt is unwelcome. So `useNewThreadPane`
(`lib/use-new-thread-pane.ts`) always opens the splash (`api.newThreadPage()` → `newThreadUrl` in `lib/show.ts`) in
the dialog's own pane (`NEW_THREAD_PANE`), and an intro plays only when you ask:

- ▶ by the title (`PlayIntroButton` in `components/FeatureIntro.tsx`) calls `playPaneIntro`, which opens it in that
  same pane. It must never go to the board's pane (`openInPane`): that one sits hidden behind the dialog's, so the
  intro used to play unseen and only show up once the dialog closed.
- The splash carries a **tip card** under the title: `TIPS` in `lib/new-thread-tips.ts` (shortcuts, the New thread
  intro, and a line per drawer that names its intro), started one further on each time (`nextTipIndex`, from a random
  place) and faded to the next every 8 s by the page's own script. A tip with an intro has **▶ Watch**, a link to it
  on Weft's own origin (the route passes `new URL(req.url).origin`). To add a tip, add a line to `TIPS`; keep it under
  140 characters and only claim what Weft really does.

The pane refuses Weft's own server, so `electron/self-url.cjs` lets exactly `/intros/<id>.html` through. On the web
there is no pane (`hasPane()` is false), so the dialog plays it in its own frame like any other intro.

The hook returns `{ id, open, ended, paused, expanded, run, src, attach, muted, toggleMuted, play, togglePlaying, setExpanded, hide }` (typed
`FeatureIntroState`); `components/FeatureIntro.tsx` takes that as one `intro` prop and reads
`INTRO_TITLES[intro.id]` for the title. The iframe's ref is handed over through `attach` rather than returned,
so no consumer reads a ref while it renders (the `react-hooks/refs` rule refuses that).

Which ones you've seen live in `localStorage` under `weft-intros-seen` (`INTROS_KEY`), as a JSON array of ids;
`loadSeenIntros` keeps only ids in `INTROS` (`isIntro`), so a stale id is dropped. Storage that's missing, blocked
or full is treated as "seen nothing" — the intro just plays again. Settings → General's **Reset tips** clears the
set too (`resetIntros`, called from `components/HistorySettings.tsx`).

`lib/feature-intros.ts` is pure and untangled from React: the id list, `INTRO_TITLES`, `introSrc`/`muteMessage`,
`introEvent` (which reads the `{ weft: "intro", event }` shape off an untrusted `postMessage`), `REPLAY_MESSAGE`
and the storage helpers.

## Where it's used

The rail draws it for whichever tool drawer is open (`components/LibraryRail.tsx`: one `useFeatureIntro` fed
`isTool(shown) && !closing ? shown : null`, so a drawer sliding shut doesn't hold it open, with `IntroButton` in the
drawer shell's title row and `IntroFrame` under it), the leagues in `components/LeaguesDialog.tsx` and the code
quality dialog in `components/ScoutDialog.tsx`. Each of those two passes a fixed id (`"leagues"`, `"quality"`) and
renders `IntroButton` (▶, beside the title) and `IntroFrame` (the modal or the docked frame, with ⤢, 🔊 and ✕ over its corner). The iframe
is `sandbox="allow-scripts"` and can't be focused, like the welcome tour's.

To add one: add the id to `INTROS` and `INTRO_TITLES`, write `public/intros/<id>.html` in the shape of the
existing pages, give it a line in `FEATURE_TAGS` (the poster's one-liner), add it to `VIDEO_INTROS` and to the id
list `scripts/verify-intros.sh` checks, `pnpm intros:narrate -- <id>`, and call `useFeatureIntro("<id>")` in the
drawer or dialog that should play it.

## Important patterns

- **The composition is the source of truth.** A page is plain HTML and a paused timeline, with no timers and no
  `tl.call`, so any frame can be produced by seeking to a time. The live player, the `?t=` check and the frame
  renderer all use that one clock; nothing is drawn twice.
- **The splash is injected, not authored.** `buildSplash()` in `player.js` puts the poster on every page, so all
  fourteen intros open alike and a new page gets one for free. What the poster says comes from the page itself (the
  `.head` row) plus the two tables in `player.js` (`FEATURE_TAGS`, `FEATURE_MARKS`); a page is never edited to
  change its poster.
- **The splash is a lead, not an overlay.** It plays on a master timeline with the story nested under it, so the
  story starts after the splash clears instead of running underneath it, and the narration is delayed by the same
  2 s so the voice and the picture start together.
- **The splash's timing is written once.** `splash-timing.js` holds the hold, the fade and the lead; the page
  plays it with and the renderer, encoder and verifier read it. A number that four files have to agree on
  belongs in one place, or retiming the poster silently desynchronises the picture from the voice.
- **The render is resumable, but never blindly.** A frame on disk is reused only if it is readable, newer than the
  kit and big enough to be a picture. The three rules are what stop a broken render from being handed back as a
  finished one.
- **The seen set is per feature and forgiving.** One id per intro in `localStorage`; missing, blocked or full
  storage replays the intro rather than hiding it, and Reset tips clears the set.
