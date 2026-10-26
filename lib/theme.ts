// Light, dark, follow the system, or a scene: one of Weft's own pictures behind the board, with a
// palette drawn from it. The choice lives in a cookie rather than localStorage because the desktop
// app's server can land on a different port, and cookies don't care about ports. The Electron shell
// reads the same cookie to match its window chrome (electron/theme-source.cjs).
import { CUSTOM_COOKIE, CUSTOM_PREFIX, THEME_VARS, decodeThemeCookie, encodeThemeCookie, type CustomTheme } from "./custom-theme";

export type Base = "light" | "dark";

// The pictures are electron/assets/*.jpg, served by app/api/scenes/[id]. Each scene's colors are in
// app/globals.css under :root[data-scene="<id>"]; `base` is the light or dark palette it builds on.
export const SCENES = [
  { id: "twin-suns", label: "Twin Suns", image: "splash-speeder.jpg", base: "dark" },
  { id: "canyon", label: "Canyon", image: "backdrop-canyon.jpg", base: "dark" },
  { id: "coast-road", label: "Coast Road", image: "backdrop-coast-road.jpg", base: "dark" },
  { id: "neon-city", label: "Neon City", image: "backdrop-neon-city.jpg", base: "dark" },
  { id: "snow-pass", label: "Snow Pass", image: "backdrop-snow-pass.jpg", base: "dark" },
  { id: "cockpit", label: "Cockpit", image: "backdrop-cockpit.jpg", base: "dark" },
  { id: "night-cockpit", label: "Night Cockpit", image: "backdrop-night-cockpit.jpg", base: "dark" },
  { id: "salt-flats", label: "Salt Flats", image: "backdrop-salt-flats.jpg", base: "light" },
] as const satisfies readonly { id: string; label: string; image: string; base: Base }[];

export type Scene = (typeof SCENES)[number];
export type SceneId = Scene["id"];
// A theme you prompted up (lib/custom-theme.ts) is "custom-<its folder>".
export type CustomThemeId = `${typeof CUSTOM_PREFIX}${string}`;
export type Theme = "system" | Base | SceneId | CustomThemeId;

export const THEMES: { id: "system" | Base; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export const THEME_COOKIE = "weft-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export const sceneUrl = (id: SceneId) => `/api/scenes/${id}`;
export const sceneOf = (theme: string) => SCENES.find((s) => s.id === theme);

const SAVED = ["light", "dark", ...SCENES.map((s) => s.id), `${CUSTOM_PREFIX}[a-z0-9-]+`].join("|");

export function savedTheme(): Theme {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(${SAVED})(?:;|$)`));
  return (match?.[1] as Theme | undefined) ?? "system";
}

// The active custom theme's palette, as the picker last saved it (null when it's missing or stale).
function savedCustom(theme: Theme) {
  if (!theme.startsWith(CUSTOM_PREFIX)) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CUSTOM_COOKIE}=([^;]*)`));
  const custom = decodeThemeCookie(match?.[1]);
  return custom && `${CUSTOM_PREFIX}${custom.id}` === theme ? custom : null;
}

// A custom theme's colors sit on <html style>, where they beat the light and dark palettes.
const CUSTOM_PROPS = [...THEME_VARS.map((v) => `--${v}`), "--scene", "--scrim", "--scene-pos"];

// Sets <html data-theme> to the palette in effect, light or dark, and data-scene to the scene, if any.
export function applyTheme() {
  const theme = savedTheme();
  const scene = sceneOf(theme);
  const custom = savedCustom(theme);
  const base = scene?.base ?? custom?.base;
  // A custom theme whose palette cookie is gone follows the system until it's picked again.
  const followSystem = theme === "system" || (!custom && theme.startsWith(CUSTOM_PREFIX));
  const dark = base ? base === "dark" : followSystem ? matchMedia(DARK_QUERY).matches : theme === "dark";
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  for (const prop of CUSTOM_PROPS) root.style.removeProperty(prop);
  if (scene) root.dataset.scene = scene.id;
  else if (custom) {
    root.dataset.scene = "custom";
    for (const [prop, value] of Object.entries(custom.props)) root.style.setProperty(prop, value);
  } else delete root.dataset.scene;
}

// The first launch has no choice saved yet, so the board opens on the scene that matches the
// system's light or dark and keeps it, instead of plain System. Only on the desktop board (served
// on 127.0.0.1): weft.zip's pages can't load the pictures (app/api/scenes is localhost-only).
export const FIRST_SCENES: Record<Base, SceneId> = { dark: "twin-suns", light: "salt-flats" };
const LOCAL_HOST = "^(127\\.0\\.0\\.1|localhost)$";
const MAX_AGE = 10 * 365 * 24 * 60 * 60;

export function setTheme(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
  applyTheme();
}

// Picks a theme you prompted up: its palette goes in its own cookie first, so the head script can
// paint it on the next load without asking the server.
export function setCustomTheme(theme: CustomTheme) {
  document.cookie = `${CUSTOM_COOKIE}=${encodeThemeCookie(theme)}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
  setTheme(`${CUSTOM_PREFIX}${theme.id}`);
}

// applyTheme, inlined into <head> so the page never paints in the wrong theme, plus the first
// launch's pick (any weft-theme cookie, even "system", means the user has chosen). A custom theme
// paints from its own cookie; one whose cookie is missing or stale follows the system.
const BASES = JSON.stringify({ light: "light", dark: "dark", ...Object.fromEntries(SCENES.map((s) => [s.id, s.base])) });
export const THEME_SCRIPT = `(function(){try{var b=${BASES},c=document.cookie,m=c.match(/(?:^|; )${THEME_COOKIE}=(${SAVED})(?:;|$)/),v=m?m[1]:"",r=document.documentElement,d=matchMedia("${DARK_QUERY}").matches;if(!/(?:^|; )${THEME_COOKIE}=[^;]/.test(c)&&new RegExp(${JSON.stringify(LOCAL_HOST)}).test(location.hostname)){v=d?"${FIRST_SCENES.dark}":"${FIRST_SCENES.light}";document.cookie="${THEME_COOKIE}="+v+"; path=/; max-age=${MAX_AGE}; SameSite=Lax"}var k=v.indexOf("${CUSTOM_PREFIX}")===0&&c.match(/(?:^|; )${CUSTOM_COOKIE}=([^;]*)/),t=k&&JSON.parse(decodeURIComponent(k[1]));if(t&&"${CUSTOM_PREFIX}"+t.id===v){r.dataset.theme=t.base==="light"?"light":"dark";r.dataset.scene="custom";for(var p in t.props)r.style.setProperty(p,t.props[p]);return}r.dataset.theme=b[v]||(d?"dark":"light");if(b[v]&&v!==b[v])r.dataset.scene=v}catch(e){}})()`;
