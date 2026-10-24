# Feature intros

Every tool drawer on the left rail, the New thread dialog, the code quality dialog and the leagues play a short
narrated video the first time you open them: what the drawer is for and what it can do. Twelve of them, each its own page in
`public/intros/`. This is the same HyperFrames idea as the welcome tour (see [welcome-tour.md](welcome-tour.md)),
scaled down to one feature instead of the whole product.

## The pages (`public/intros/`)

One `<id>.html` per intro, listed in `INTROS` in `lib/feature-intros.ts` — that list is the contract; an id
without a page plays a blank frame, and a page not in the list is never shown. Each page is plain HTML plus a
paused GSAP timeline handed to `window.weftIntro(tl)`, drawn with the shared `kit.css` (a 16:9 1600×900 stage: the
drawer's art on the left inside `<div class="abs art">`, in the 800-wide coordinates it was drawn in and clipped there,
and the `.head` title and `.cap` captions in the right column, in type big enough to read in the rail's 272 px drawer)
and played by the shared `player.js`. Anything that sits over the panel (a Touch ID sheet, the cursor) goes inside
`.art`; a page's own closing line goes in the right column like a caption (`#close` in `vault.html`):

| | |
|---|---|
| `player.js` | `window.weftIntro` scales the stage to the frame and, with `?live=1`, plays the timeline once from the top **with its own voice** (the `<id>.m4a` beside the page; `?muted=1` starts it muted, `{ weft: "intro-mute", muted }` flips it). The timeline waits for the voice to really play (or fail, or 4 s), and a voice later than that pulls the frames back to where it is. It posts `{ weft: "intro", event: "start" }` when it starts and `{ weft: "intro", event: "done" }` when it ends, and takes `{ weft: "intro-go" }` from the parent to start over. `?t=<seconds>` holds the frame there instead, for checking a scene by eye. |
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
not what Weft is.

It holds for 1.5 s and fades over 0.5 s — 2 s of lead before the story. It plays on a **master** timeline with the
page's own timeline nested under it (`master.add(tl, lead)`), which keeps the whole composition seekable for the
frame-by-frame render. A nested timeline only advances if it isn't paused itself, so `tl.paused(false)` follows the
`add`; the master is the only paused thing. `?t=` maps to the story's own clock — `?t=0` shows the splash, `?t=2`
shows the story two seconds in.

The narration is delayed by the same 2 s when the video is encoded, so the voice starts with the picture instead
of underneath the splash.

### The portrait render

`?ratio=9:16` restacks the landscape stage into a tall 1600×2844 canvas (`html.portrait` in `kit.css`): the drawer
art on top, the title and caption below. `player.js` then scales against 2844 rather than 900, so a vertical video
fills its frame instead of sitting in a black band. The stage is taken out of the flow (`position: fixed`) in
portrait, because a 2844 px canvas would otherwise grow the document and shrink the viewport the stage is scaled
against.

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

## When it shows (`lib/use-feature-intro.ts`)

`useFeatureIntro(id)` takes the drawer (or dialog) that's open, or `null`, and returns the state
`components/FeatureIntro.tsx` draws:

- It opens by itself the **first** time that drawer's id comes up, unless you've already seen it or you ask for
  reduced motion (`prefers-reduced-motion: reduce`).
- It's seen once the page plays to the end (`done`) or you hide it, so hiding counts too.
- The page plays its own voice, and stops it when you hide it or the drawer closes (both unmount the frame). The board
  used to start it on `start`, but the sandboxed frame animates in its own process while the board's window can be
  busy for seconds as a drawer opens, so the voice came in that late. The hook shares the welcome tour's 🔊 setting
  (`readMuted`/`writeMuted` in `lib/welcome-voice.ts`, the same localStorage key), so muting one mutes the other:
  in the frame's address when it loads (`introSrc(id, muted)`) and as `muteMessage` when you flip it, so a flip
  doesn't reload the page.
- Messages count only from the intro's own iframe (`e.source === frame.current?.contentWindow`, and only once it has
  one); another frame on the page can't drive it.
- ▶ beside the title plays it again: an open intro is asked to start over, a closed one is loaded fresh (a new
  `run` remounts the iframe). ↻ Replay appears over the frame once it ends.

## New thread plays in the browser pane (`lib/pane-intro.ts`)

The New thread intro is a minute of tips, and one of them is about the browser pane, so on the desktop it plays
there, beside the dialog, at full size rather than in a frame over the composer. `usePaneIntro("newthread")` opens
`/intros/newthread.html?live=1` in the board's pane (`openInPane`) the first time the dialog opens, marks it seen
right away (the pane's page has no parent to post `done` to), and returns the ▶ that opens it again
(`PlayIntroButton` in `components/FeatureIntro.tsx`). The pane refuses Weft's own server, so
`electron/self-url.cjs` lets exactly `/intros/<id>.html` through. On the web there is no pane (`hasPane()` is
false), so the dialog plays it in its own frame like any other intro.

The hook returns `{ id, open, ended, run, src, attach, muted, toggleMuted, play, hide }` (typed
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
renders `IntroButton` (▶, beside the title) and `IntroFrame` (the frame with 🔊 and ✕ over its corner). The iframe
is `sandbox="allow-scripts"` and can't be focused, like the welcome tour's.

To add one: add the id to `INTROS` and `INTRO_TITLES`, write `public/intros/<id>.html` in the shape of the
existing pages, `pnpm intros:narrate -- <id>`, and call `useFeatureIntro("<id>")` in the drawer or dialog that
should play it.