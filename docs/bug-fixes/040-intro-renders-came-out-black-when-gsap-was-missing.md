# 040: three intro renders came out completely black

**Date:** 2026-10-26 · **Severity:** High (no crash, and nothing looked broken: three of the eleven intro videos were
finished files with the right duration, an AAC track and a poster frame — every frame of them was the page's
background, so the videos showed nothing at all)

## Symptom

Eleven intro videos were rendered on the Mac mini that keeps the sources synced. Three of them played completely
black. Everything around the video said it was fine: the file existed, its duration matched the story, it had an AAC
track, and the poster frame pulled out of the finished mp4 was a picture. It was just the background, over and over,
for the whole video.

The other eight were fine, which is what made it confusing: the compositions, the renderer and ffmpeg all worked.

## Root cause

**The pages couldn't draw because GSAP wasn't there.** Every intro page loads GSAP from a path relative to itself:

```html
<!-- public/intros/vault.html -->
<script src="../welcome/gsap.min.js"></script>
```

which resolves to `public/welcome/gsap.min.js` — beside the compositions, not inside them. The Mac mini that did
the rendering had its copy of the sources synced **without** that file, so `gsap` was undefined on the page. The
page's own script then threw before it built its timeline, the composition never drew a single thing, and the
browser was left showing the page's background.

**The renderer turned that into a finished video.** A frame capture doesn't know whether the page loaded: headless
Chrome was asked for a screenshot and wrote one, every time. The blank frames were on disk, the right number of
them, the right names. The encoder then did exactly what it was told — mux the frames and the narration — and
produced an mp4 with the right length and a silent-but-present audio track.

**The resume made it worse.** The renderer is resumable: a frame already on disk is kept, so an interrupted render
picks up where it stopped. But "present" was the only test. A blank frame is present, so the second run did not
recapture the black frames — it handed back exactly the frames that had failed, and called the render finished.

## Fix

**The renderer no longer trusts a frame it hasn't looked at.** A frame counts as done only if it is big enough to be
a picture: a real frame is well over 30 KB, a blank one about 10 KB. A frame under 30 KB is recaptured, so a broken
page can never be resumed into a finished video.

```js
// before — scripts/render-intros.mjs
if (!fresh && existsSync(file)) continue;
```

```js
// after — scripts/render-intros.mjs
if (!fresh && existsSync(file)) {
  const size = statSync(file).size;
  if (size > 30000 && statSync(file).mtimeMs >= kitTime) continue;
}
```

The same `if` carries the staleness rule it already had: a frame older than `player.js` was captured against the
composition as it was before, so it is recaptured too. A frame only counts as done when it is readable, recent and
**not blank** — three conditions, because each catches a different way a resume can hand back the wrong video.

**The verifier checks the poster frame out of the finished mp4, not out of the frames.** The frames were the thing
that was wrong; looking at them proves nothing about the video. So the verifier pulls the splash frame out of the
finished file and measures it. A real splash is well over 100 KB; a blank one is about 10 KB.

```bash
# after — scripts/verify-intros.sh
ffmpeg -v error -ss 1 -i "$f" -frames:v 1 "/tmp/verify-splash-$id.png" -y
splash_bytes=$(stat -f%z "/tmp/verify-splash-$id.png" 2>/dev/null || echo 0)
if [ "$splash_bytes" -lt 100000 ]; then ok="BLANK (splash frame only ${splash_bytes}B)"; fi
```

**The render job checks GSAP is beside the sources before it starts.** The missing file was the root cause, so it is
caught where it is introduced: the job script on the rendering machine looks for `gsap.min.js` beside the
compositions before it runs, and says so plainly if it isn't there, instead of rendering eleven videos and finding
out afterwards.

**The splash's timing is written down once.** The lead — how long the poster is up before the story starts — was
written out in four places: the page, the renderer, the encoder and the verifier. They agreed, but nothing kept
them agreeing. Retiming the splash would have left the voice delayed by the old number and the verifier expecting
the old length, and nothing would have said so. It now lives in `public/intros/splash-timing.js`, which the page
plays it with and the three scripts read; each script stops with a plain message if the file is missing.

**Key rule:** a render step that can produce an empty output must check the output, not just the inputs — and a
resume may only reuse a frame it has proved is a frame.

## Files

- `scripts/render-intros.mjs` — recaptures any frame under 30 KB, so a blank frame can never be resumed into a
  finished video
- `scripts/verify-intros.sh` — measures the poster frame pulled out of the finished mp4 and flags a blank one
- `public/intros/player.js` — the splash the poster frame is taken from
- `public/intros/kit.css` — the splash's own styles (the poster frame is over 100 KB because of them)
- `public/intros/splash-timing.js` — the splash's hold, fade and lead, in the one place the page and the three
  scripts read them from
- `scripts/encode-intros.sh` — muxes the frames and the narration; it is unchanged by this fix, and is worth knowing
  that it does **not** look at the frames it is given
- `docs/architecture/feature-intros.md` — the render pipeline and the blank-frame trap
- The rendering machine's job script (not in this repo) — checks GSAP is beside the sources before the render starts
