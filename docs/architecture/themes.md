# Themes and scenes

Settings → Appearance (or ⌘K "Theme: …") picks how the board looks: **System**, **Light**, **Dark**, or a **scene**:
one of Weft's own pictures behind the board, with a palette drawn from it and clear columns (a faint edge, no frost) so the picture shows between the cards.

| Scene | Picture (`electron/assets/`) | Builds on |
| --- | --- | --- |
| Twin Suns | `splash-speeder.jpg` | dark |
| Canyon | `backdrop-canyon.jpg` | dark |
| Coast Road | `backdrop-coast-road.jpg` | dark |
| Neon City | `backdrop-neon-city.jpg` | dark |
| Snow Pass | `backdrop-snow-pass.jpg` | dark |
| Cockpit | `backdrop-cockpit.jpg` | dark |
| Night Cockpit | `backdrop-night-cockpit.jpg` | dark |
| Salt Flats | `backdrop-salt-flats.jpg` | light |

## Key files

- `lib/theme.ts`: `SCENES` (id, label, picture, base palette) is the one list; `Theme` is `"system" | "light" | "dark" | SceneId`.
  `savedTheme()` reads the `weft-theme` cookie, `setTheme()` writes it and applies it, `applyTheme()` sets
  `<html data-theme>` (the base, light or dark) and `<html data-scene>` (the scene, if any).
  `THEME_SCRIPT` is the same logic inlined into `<head>` so the first paint is right. It also makes the first launch's pick:
  with no `weft-theme` cookie (or an empty one) on `127.0.0.1`/`localhost`, it saves `FIRST_SCENES[dark|light]`
  (Twin Suns or Salt Flats, by the system's mode) before painting. Any saved value, `system` included, is a choice and
  is left alone; weft.zip never gets a pick, since its pages can't load the pictures (`app/api/scenes` is localhost-only).
- The weft.zip home page's third-party tracking (Google Analytics, mounted only on the marketing page)
  lives in `docs/architecture/analytics.md`.
- `app/globals.css`: the light palette on `:root` and the dark one on `:root[data-theme="dark"]`; each scene is a
  `:root[data-scene="<id>"]` block that overrides the colors and sets `--scene` (its picture) and `--scrim`
  (a gradient that keeps text readable). `:root[data-scene] body` paints scrim, picture, then canvas;
  `:root[data-scene] [data-column].bg-sunken` makes the columns clear with a faint `--line-strong` edge, so the picture shows between the cards; a drag still lights a column with `bg-accent-soft`.
- `app/api/scenes/[id]/route.ts`: serves a scene's JPEG from `electron/assets/`. Only ids in `SCENES` resolve, so the
  id can't name another file; localhost-only like every route (`lib/guard.ts`); cached for a day.
- `components/AppearancePicker.tsx`: the Settings control: three buttons, then a picture tile per scene.
  `components/board-palette.ts` adds a "Theme: …" command per theme and scene.
- `electron/theme-source.cjs`: what `nativeTheme.themeSource` should be for the cookie's value (a scene follows its
  base; unknown values follow the system). `electron/main.cjs` `setThemeSource()` uses it, so window chrome, native
  menus and the splash match the scene. Its test checks the table against `SCENES`.

## Data flow

Pick → `setTheme(id)` writes the `weft-theme` cookie (cookies survive the app's server landing on a different port,
localStorage doesn't) → `applyTheme()` sets the two `<html>` attributes → CSS swaps the palette and the picture loads
from `/api/scenes/<id>` → Electron main watches the cookie (`followThemeChoice()`, docs/architecture/desktop-shell.md)
and sets `nativeTheme.themeSource`.

## Adding a scene

1. Put the JPEG in `electron/assets/`.
2. Add a row to `SCENES` in `lib/theme.ts` and to `BASES` in `electron/theme-source.cjs`.
3. Add a `:root[data-scene="<id>"]` block in `app/globals.css`, copying a scene with the same base.
   The picture is cropped `cover` at `center 62%`; a scene whose subject sits low (Cockpit's dashboard) sets `--scene-pos`
   (`center 100%`) to move the crop.

Cockpit's picture was rendered with BlastCP (`generate_image`): a FLUX.2 klein 9B spaceship windshield on a starfield with
the slate dashboard in the bottom fifth, then an edit (GPT Image 2.5 Sunburst, the render and `electron/assets/emblem.png`
as references) that lights the splash screen's steel weave emblem on the centre console screen. Its palette is the frame's
slate greys with the console screens' cyan as the accent.
Night Cockpit is an edit of that picture (GPT Image 2.5 Sunburst, the Cockpit as the only reference): the same frame and console, parked
on a desert planet on a moonless night under a dense starfield and a spiral galaxy; its accent is the galaxy arms' violet. A scene picked by position in `SCENES` shifts when one is added:
look scenes up by id (`FIRST_SCENES`, `lib/settings-nav.ts`).

`electron/theme-source.test.ts` fails when `BASES` drifts from `SCENES`; `lib/theme.test.ts` checks each scene has a unique id and a jpg.

## Prompted themes

Settings → Appearance ends with a **Your own** tile: describe a theme in words, bring your own picture, or both, and a thread makes it.

```
"rainy Tokyo alley, neon pink" ─► POST /api/themes ─► startThemeCard(): mkdir ~/.weft/themes/<id>, start a card
                                                        (cwd ~/.weft/themes, tag "theme", brief = themeCardPrompt)
  (multipart with a picture: picture.(jpg|png|webp) saved first)
card ─► picture.(jpg|png|webp|svg) (or keeps yours) + theme.json ─► GET /api/themes lists it ─► picker polls every 4s, picks it on arrival
```

- `lib/custom-theme.ts` (pure, shared): `THEME_VARS` (the twelve palette variables a scene sets), `parseCustomTheme()` keeps
  only safe values (`safeCss`: colors and gradients, no `url(`, nothing that ends a declaration) and needs canvas, ink and
  accent; `themeProperties()` turns a theme into CSS custom properties, `--scene` pointing at its picture route or `none`.
- `lib/custom-themes.ts` (server): reads `~/.weft/themes/*/theme.json`, newest first, skipping folders still being painted;
  `startThemeCard()` names the folder from the first words (`themeIdFrom`) and starts the card. The brief asks for an image
  tool's render when the thread has one, a hand-drawn SVG otherwise, and a contrast check (ink on card 7:1, muted 4.5:1).
- **Your own picture.** The describe box has a picture slot beside the words (`components/ThemeDescriber.tsx`
  `PictureSlot`: click to pick, drop on the slot, the form or the collapsed **Your own** tile, × to clear); with a picture
  the words are optional and the button reads "Theme it". `api.themeFromPicture()` posts multipart (prompt, picture) to
  `POST /api/themes`, which reads `req.formData()` when the content type says multipart (`/api/themes` is outside
  `proxy.ts`'s matcher, so Next's 10 MB proxy body cap doesn't apply). `startThemeCard(text, upload)` refuses anything
  over `MAX_PICTURE_BYTES` (20 MB) and anything `uploadedPictureName()` doesn't know by its first bytes (JPEG, PNG, WebP;
  never SVG, which could carry script), then writes `picture.<ext>` into the new folder **before** the card starts. The
  folder is named from the words, else the file's name, else `picture`. The brief (`themeCardPrompt(…, picture)`) says the
  picture is already there and must stay untouched, to open it and draw the palette and base from it, and to make the scrim
  strong enough over its brightest, busiest parts that columns and cards read clearly; later edits touch theme.json only.
  Until theme.json lands the folder is skipped by the list like any theme being painted.
- `app/api/themes/[id]/picture`: only a `THEME_ID` folder and a `PICTURES` file name resolve; an SVG goes out with a
  `default-src 'none'` CSP so a thread-drawn file can't run script; `no-cache`, since a thread may repaint it.
- Applying: the theme cookie holds `custom-<id>`; a second cookie, `weft-custom-theme`, holds its id, base and properties
  (`encodeThemeCookie`), so `THEME_SCRIPT` paints it before React without asking the server. The properties go on
  `<html style>` (beating both palettes) with `data-scene="custom"`, so `:root[data-scene] body` lays the picture and the
  columns go clear like any scene. A `custom-` value whose cookie is missing or stale follows the system.
- `lib/use-custom-themes.ts` loads the list when Appearance opens, polls while a theme is painting, and rewrites the
  active theme's cookie so a repaint shows up. `electron/theme-source.cjs` `followThemeChoice()` watches both cookies and
  sets `nativeTheme` from the custom theme's base.

## Patterns

- Colors come only from CSS variables, so a scene needs no component changes; any new surface should use `--panel`,
  `--card` or `--sunken`, never a hard-coded color.
- The picture is a CSS background on `body`, behind everything; columns are clear over it (no `backdrop-filter`).
- Settings paints its own copy of the picture (`components/SettingsDialog.tsx`): `useSettingsBackdrop()` in
  `lib/use-scene.ts` returns the scrim plus the scene's `/api/scenes/<id>` picture, or, when `data-scene="custom"`,
  `var(--scene) var(--scene-pos)` from the properties `applyTheme` set on `<html>`. A MutationObserver on `data-scene`,
  `data-theme` and `style` keeps it current while Appearance is open, so a custom theme never falls back to Twin Suns.
