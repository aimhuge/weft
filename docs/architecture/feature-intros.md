# Feature intros

Every tool drawer on the left rail, the code quality dialog and the leagues play a short narrated video the
first time you open them: what the drawer is for and what it can do. Eleven of them, each its own page in
`public/intros/`. This is the same HyperFrames idea as the welcome tour (see [welcome-tour.md](welcome-tour.md)),
scaled down to one feature instead of the whole product.

## The pages (`public/intros/`)

One `<id>.html` per intro, listed in `INTROS` in `lib/feature-intros.ts` — that list is the contract; an id
without a page plays a blank frame, and a page not in the list is never shown. Each page is plain HTML plus a
paused GSAP timeline handed to `window.weftIntro(tl)`, drawn with the shared `kit.css` (a portrait 800×1000 stage,
sized to read in the rail's 272 px drawer) and played by the shared `player.js`:

| | |
|---|---|
| `player.js` | `window.weftIntro` scales the stage to the frame and, with `?live=1`, plays the timeline once from the top **with its own voice** (the `<id>.m4a` beside the page; `?muted=1` starts it muted, `{ weft: "intro-mute", muted }` flips it). The timeline waits for the voice to really play (or fail, or 4 s), and a voice later than that pulls the frames back to where it is. It posts `{ weft: "intro", event: "start" }` when it starts and `{ weft: "intro", event: "done" }` when it ends, and takes `{ weft: "intro-go" }` from the parent to start over. `?t=<seconds>` holds the frame there instead, for checking a scene by eye. |
| `kit.css` | The shared look: the stage, the caption, the chip row. |

Like the welcome tour's pages, the timelines use no timers and no `tl.call`, so a frame is drawn purely by
seeking. Captions live in the page and the voice in its `#narration` block (`<script type="application/json"
id="narration">`), so the text and the track change together.

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