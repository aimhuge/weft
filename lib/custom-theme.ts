// A theme you prompted up: a thread paints a picture and picks a palette for it, then writes
// ~/.weft/themes/<id>/theme.json (lib/custom-themes.ts reads it). This half is pure, shared by the
// server, the Appearance picker and the head script: what a theme holds, which values are safe to
// put in CSS, and how the active one rides in a cookie so the first paint is already right.
import type { Base } from "./theme";

// The palette variables a theme sets, the same ones a built-in scene sets in app/globals.css.
export const THEME_VARS = [
  "canvas",
  "panel",
  "card",
  "sunken",
  "line",
  "line-strong",
  "ink",
  "muted",
  "faint",
  "accent",
  "accent-soft",
  "on-accent",
] as const;
export type ThemeVar = (typeof THEME_VARS)[number];

// The picture names a theme folder may hold, and the content type each one is served as.
export const PICTURES = {
  "picture.jpg": "image/jpeg",
  "picture.jpeg": "image/jpeg",
  "picture.png": "image/png",
  "picture.webp": "image/webp",
  "picture.svg": "image/svg+xml",
} as const;
export type PictureName = keyof typeof PICTURES;
const isPicture = (name: string): name is PictureName => Object.hasOwn(PICTURES, name);

export interface CustomTheme {
  id: string;
  label: string;
  base: Base;
  // What you asked for, so the tile can show it and a re-prompt can start from it.
  prompt: string;
  colors: Partial<Record<ThemeVar, string>>;
  // A gradient over the picture that keeps text readable on it.
  scrim?: string;
  // Where the picture's crop sits, e.g. "center 100%" for a subject low in the frame.
  scenePos?: string;
  // The picture's file name in the theme's folder, when it has one.
  picture?: PictureName;
}

export const CUSTOM_PREFIX = "custom-";
export const CUSTOM_COOKIE = "weft-custom-theme";
export const THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Colors and gradients only: no url() (it would fetch), and nothing that could close the
// declaration or the rule it sits in.
const SAFE_VALUE = /^[a-zA-Z0-9#%.,()\s/+-]{1,160}$/;
export function safeCss(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  return SAFE_VALUE.test(v) && !/url\s*\(/i.test(v) ? v : undefined;
}

// The palette variables theme.json names, with or without their leading "--", that are safe to paint.
function readColors(raw: unknown): CustomTheme["colors"] {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colors: CustomTheme["colors"] = {};
  for (const name of THEME_VARS) {
    const v = safeCss(src[name] ?? src[`--${name}`]);
    if (v) colors[name] = v;
  }
  return colors;
}

// The optional parts, left out rather than set to undefined.
function extras(r: Record<string, unknown>, pictures: string[]): Pick<CustomTheme, "scrim" | "scenePos" | "picture"> {
  const out: Pick<CustomTheme, "scrim" | "scenePos" | "picture"> = {};
  const scrim = safeCss(r.scrim);
  const scenePos = safeCss(r.scenePos);
  const picture = pictures.find(isPicture);
  if (scrim) out.scrim = scrim;
  if (scenePos) out.scenePos = scenePos;
  if (picture) out.picture = picture;
  return out;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// theme.json as a thread wrote it, kept only where it's safe and complete enough to paint.
export function parseCustomTheme(id: string, raw: unknown, pictures: string[] = []): CustomTheme | null {
  if (!THEME_ID.test(id) || !raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const colors = readColors(r.colors);
  if (!colors.canvas || !colors.ink || !colors.accent) return null;
  return {
    id,
    label: text(r.label, 40) || id,
    base: r.base === "light" ? "light" : "dark",
    prompt: text(r.prompt, 500),
    colors,
    ...extras(r, pictures),
  };
}

export const customPictureUrl = (id: string) => `/api/themes/${id}/picture`;

// The CSS custom properties to set on <html> for a theme. Without a picture it is a palette alone.
export function themeProperties(t: CustomTheme): Record<string, string> {
  const props: Record<string, string> = {};
  for (const name of THEME_VARS) {
    const value = t.colors[name];
    if (value) props[`--${name}`] = value;
  }
  props["--scene"] = t.picture ? `url("${customPictureUrl(t.id)}")` : "none";
  props["--scrim"] = t.scrim ?? "linear-gradient(transparent, transparent)";
  if (t.scenePos) props["--scene-pos"] = t.scenePos;
  return props;
}

// What the head script needs before first paint: the theme's id, base and properties. Kept in its own
// cookie, beside weft-theme, for the same reason: the desktop server's port changes, cookies don't care.
export interface ThemeCookie {
  id: string;
  base: Base;
  props: Record<string, string>;
}

export const encodeThemeCookie = (t: CustomTheme): string =>
  encodeURIComponent(JSON.stringify({ id: t.id, base: t.base, props: themeProperties(t) } satisfies ThemeCookie));

export function decodeThemeCookie(value: string | undefined): ThemeCookie | null {
  if (!value) return null;
  try {
    const c = JSON.parse(decodeURIComponent(value)) as Record<string, unknown> | null;
    return typeof c?.id === "string" && typeof c.props === "object" && c.props !== null ? (c as unknown as ThemeCookie) : null;
  } catch {
    return null;
  }
}

// A folder name for a new theme, from what you asked for: "rainy tokyo alley at night" -> rainy-tokyo-alley.
export function themeIdFrom(prompt: string, taken: (id: string) => boolean): string {
  const words = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const base = words.slice(0, 3).join("-").slice(0, 30).replace(/-+$/, "") || "theme";
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}
