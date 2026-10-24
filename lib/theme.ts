// Light, dark, follow the system, or a scene: one of Weft's own pictures behind the board, with a
// palette drawn from it. The choice lives in a cookie rather than localStorage because the desktop
// app's server can land on a different port, and cookies don't care about ports. The Electron shell
// reads the same cookie to match its window chrome (electron/theme-source.cjs).
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
export type Theme = "system" | Base | SceneId;

export const THEMES: { id: "system" | Base; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export const THEME_COOKIE = "weft-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export const sceneUrl = (id: SceneId) => `/api/scenes/${id}`;
export const sceneOf = (theme: string) => SCENES.find((s) => s.id === theme);

const SAVED = ["light", "dark", ...SCENES.map((s) => s.id)].join("|");

export function savedTheme(): Theme {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(${SAVED})(?:;|$)`));
  return (match?.[1] as Theme | undefined) ?? "system";
}

// Sets <html data-theme> to the palette in effect, light or dark, and data-scene to the scene, if any.
export function applyTheme() {
  const theme = savedTheme();
  const scene = sceneOf(theme);
  const dark = scene ? scene.base === "dark" : theme === "system" ? matchMedia(DARK_QUERY).matches : theme === "dark";
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  if (scene) root.dataset.scene = scene.id;
  else delete root.dataset.scene;
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

// applyTheme, inlined into <head> so the page never paints in the wrong theme, plus the first
// launch's pick (any weft-theme cookie, even "system", means the user has chosen).
const BASES = JSON.stringify({ light: "light", dark: "dark", ...Object.fromEntries(SCENES.map((s) => [s.id, s.base])) });
export const THEME_SCRIPT = `(function(){try{var b=${BASES},c=document.cookie,m=c.match(/(?:^|; )${THEME_COOKIE}=(${SAVED})(?:;|$)/),v=m?m[1]:"",r=document.documentElement,d=matchMedia("${DARK_QUERY}").matches;if(!/(?:^|; )${THEME_COOKIE}=[^;]/.test(c)&&new RegExp(${JSON.stringify(LOCAL_HOST)}).test(location.hostname)){v=d?"${FIRST_SCENES.dark}":"${FIRST_SCENES.light}";document.cookie="${THEME_COOKIE}="+v+"; path=/; max-age=${MAX_AGE}; SameSite=Lax"}r.dataset.theme=b[v]||(d?"dark":"light");if(b[v]&&v!==b[v])r.dataset.scene=v}catch(e){}})()`;
