// Themes you prompted up, on disk: one folder per theme under ~/.weft/themes, holding the
// theme.json and picture a thread made for it. Describing a theme in Settings → Appearance starts
// that thread here (app/api/themes); the picker lists what's finished. The pure half, what a theme
// holds and which values are safe, is lib/custom-theme.ts.
import fs from "node:fs";
import path from "node:path";
import { PICTURES, parseCustomTheme, themeIdFrom, type CustomTheme, type PictureName } from "./custom-theme";
import { startFeatureCard } from "./card-starter";
import { defaultBackend } from "./settings";
import { DATA_DIR } from "./store";
import type { Card } from "./types";

export const themesDir = () => path.join(DATA_DIR, "themes");

export function readCustomTheme(id: string): CustomTheme | null {
  const dir = path.join(themesDir(), id);
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(dir, "theme.json"), "utf8"));
    return parseCustomTheme(id, raw, fs.readdirSync(dir));
  } catch {
    return null;
  }
}

// Every finished theme, newest first; a folder still being painted (no valid theme.json yet) is left out.
export function listCustomThemes(): CustomTheme[] {
  let names: string[];
  try {
    names = fs.readdirSync(themesDir());
  } catch {
    return [];
  }
  const mtime = (id: string) => fs.statSync(path.join(themesDir(), id)).mtimeMs;
  return names
    .map(readCustomTheme)
    .filter((t): t is CustomTheme => t !== null)
    .sort((a, b) => mtime(b.id) - mtime(a.id));
}

export function customThemePicture(id: string): { file: string; type: string } | null {
  const theme = readCustomTheme(id);
  if (!theme?.picture) return null;
  return { file: path.join(themesDir(), id, theme.picture), type: PICTURES[theme.picture] };
}

// A picture you brought, as the route read it from the upload.
export interface UploadedPicture {
  bytes: Uint8Array;
  // The file's own name, which names the theme when you wrote no words.
  name?: string;
}

export const MAX_PICTURE_BYTES = 20 * 1024 * 1024;

// What an upload is, from its first bytes rather than the type the browser claims. Photos only: an SVG
// you drop could carry script, and a thread never needs to repaint yours.
export function uploadedPictureName(bytes: Uint8Array): PictureName | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "picture.jpg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "picture.png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "picture.webp";
  return null;
}

// Step 1 of the brief: paint a picture from the words, or keep the one you brought and look at it.
function pictureStep(dir: string, picture?: PictureName): string {
  if (picture)
    return `1. The picture is already there: ${dir}/${picture}, which I uploaded as the theme's backdrop. Keep it exactly as it is (don't edit, replace or re-encode it); open it and study its colour scheme, its light and where its busy detail sits. Every color below comes from it.`;
  return `1. The picture, behind the whole board (a 16:10 landscape, ~2560x1600, calm enough that cards stay readable over it; keep the busiest detail out of the middle band where the columns sit).
   - If you have an image-generation tool (an MCP generate_image or the like), render it and save it as picture.jpg (or .png/.webp).
   - Otherwise draw it yourself as picture.svg: a hand-made SVG scene (gradients, shapes, light), viewBox="0 0 2560 1600", no external references.
   Show it to me inline in your reply as soon as it's made.`;
}

// The brief the thread gets. It names the folder and the file's exact shape, says how to make the
// picture with whatever the thread can reach (or to build around the one you uploaded), and asks for a readable palette.
export function themeCardPrompt(description: string, id: string, dir: string, picture?: PictureName): string {
  const ask = picture
    ? `Make a Weft board theme around the picture I uploaded${description ? `, with this in mind: "${description}"` : ""}.`
    : `Make a Weft board theme from this description: "${description}"`;
  const readable = picture
    ? " The picture stays as it is, so the scrim does the work: make it strong enough over the picture's brightest, busiest parts that columns and cards read clearly, and set scenePos to keep its subject in view."
    : "";
  return `${ask}

Write it into ${dir}/${picture ? "" : " (create the folder)"}:

${pictureStep(dir, picture)}
2. theme.json, exactly this shape (colors are hex or rgb()/hsl() values, no url()):
{
  "label": "<two or three words>",
  "base": "dark" | "light",
  "prompt": ${JSON.stringify(description)},
  "colors": {
    "canvas": "<page color, the picture's darkest/lightest tone>",
    "panel": "<side panels>", "card": "<cards, solid>",
    "sunken": "<wells; see-through, e.g. rgb(r g b / 0.4)>",
    "line": "<faint divider, ~0.09 alpha>", "line-strong": "<stronger edge, ~0.18 alpha>",
    "ink": "<text>", "muted": "<secondary text>", "faint": "<tertiary text>",
    "accent": "<the picture's signature color>", "accent-soft": "<accent at ~0.15 alpha>", "on-accent": "<text on an accent button>"
  },
  "scrim": "<a linear-gradient over the picture that keeps text readable, e.g. linear-gradient(180deg, rgb(6 10 20 / 0.3), rgb(6 10 20 / 0.05) 55%, rgb(6 10 20 / 0.35))>",
  "scenePos": "center 62%"
}

Draw the palette from the picture, and pick the base (dark or light) from its overall tone.${readable} Check contrast before you finish: ink on card at least 7:1, muted on card at least 4.5:1, on-accent on accent at least 4.5:1.

The theme appears in Settings → Appearance as soon as theme.json is valid; tell me to pick it there. If I ask for changes later, edit ${picture ? "theme.json; the picture stays mine" : "the same two files"}.`;
}

// The words that name a theme's folder: what you wrote, else the uploaded file's name.
const nameWords = (text: string, picture?: UploadedPicture) =>
  text || (picture?.name ?? "").replace(/\.[a-z0-9]+$/i, "") || "picture";

// Starts the thread that paints a theme. Its folder is ~/.weft/themes, so every theme thread sits
// under one project on the board. With a picture you uploaded, the words are optional: the picture is
// saved into the folder first and the thread writes the theme around it.
export async function startThemeCard(description: string, upload?: UploadedPicture): Promise<{ id: string; card: Card }> {
  const text = description.trim().slice(0, 500);
  if (!text && !upload) throw new Error("Describe the theme you want.");
  const saved = upload && { file: checkedPicture(upload), bytes: upload.bytes };
  const root = themesDir();
  fs.mkdirSync(root, { recursive: true });
  const id = themeIdFrom(nameWords(text, upload), (name) => fs.existsSync(path.join(root, name)));
  const dir = path.join(root, id);
  fs.mkdirSync(dir);
  if (saved) fs.writeFileSync(path.join(dir, saved.file), saved.bytes);
  const card = await startFeatureCard({
    title: `Theme: ${(text || "from your picture").slice(0, 60)}`,
    prompt: themeCardPrompt(text, id, dir, saved?.file),
    cwd: root,
    backend: defaultBackend(),
    tags: ["theme"],
  });
  return { id, card };
}

function checkedPicture(upload: UploadedPicture): PictureName {
  if (upload.bytes.length > MAX_PICTURE_BYTES) throw new Error("That picture is over 20 MB; try a smaller one.");
  const name = uploadedPictureName(upload.bytes);
  if (!name) throw new Error("Use a JPEG, PNG or WebP picture.");
  return name;
}
