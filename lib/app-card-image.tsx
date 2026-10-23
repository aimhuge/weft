// A shared mini app's branded link-preview card (lib/app-preview.ts): the app's glyph, name, description and owner on
// the home page's palette, with the Mac's capture of the app tilted in on the right when there is one. weft.zip draws
// it at /api/a/<id>/og for public links; the Share dialog draws the same card locally from this Mac's capture
// (lib/app-share-preview-actions.ts), so what you see there is what Slack shows. Fonts and emblem as app/opengraph-image.tsx.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { appGlyph } from "./mini-apps";

export const APP_CARD_SIZE = { width: 1200, height: 630 };

export interface AppCardInput {
  name: string;
  title?: string;
  description?: string;
  // "@fotoflo" or a workspace's name: who the app is by.
  byline: string;
  // The capture, as PNG (or WebP/JPEG) bytes.
  shot?: ArrayBuffer | null;
}

// Literal paths, so file tracing sees them (next.config.ts lists them for the route too).
async function assets(): Promise<{ font: ArrayBuffer; emblem: string }> {
  const [font, emblem] = await Promise.all([
    readFile(path.join(process.cwd(), "public/fonts/fraunces-500.ttf")),
    readFile(path.join(process.cwd(), "electron/assets/emblem.png")),
  ]);
  return {
    font: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
    emblem: `data:image/png;base64,${emblem.toString("base64")}`,
  };
}

// A picture's type from its first bytes, or null when it isn't PNG, JPEG, GIF or WebP.
export function imageType(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return null;
}

export function imageDataUrl(bytes: ArrayBuffer): string {
  return `data:${imageType(bytes) ?? "image/png"};base64,${Buffer.from(bytes).toString("base64")}`;
}

// The name without the glyph it starts with ("📈 Growth" draws 📈 in the tile and "Growth" as the title).
export function cardTitle(input: Pick<AppCardInput, "name" | "title">): string {
  const glyph = appGlyph(input.name);
  const title = input.title ?? input.name;
  return glyph.emoji && title.startsWith(glyph.text) ? title.slice(glyph.text.length).trim() || title : title;
}

function Glyph({ name, emoji, size }: { name: string; emoji: boolean; size: number }) {
  const glyph = appGlyph(name);
  const text = glyph.emoji && !emoji ? cardTitle({ name }).charAt(0).toUpperCase() : glyph.text;
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.24, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.56, color: "#fff", fontFamily: "Fraunces",
        background: glyph.emoji && emoji ? "rgba(255,255,255,0.08)" : `hsl(${glyph.hue} 55% 42%)`,
        border: "2px solid rgba(255,255,255,0.12)",
      }}
    >
      {text}
    </div>
  );
}

function Shot({ src }: { src: string }) {
  return (
    <div
      style={{
        position: "absolute", left: 640, top: 150, width: 620, height: 326, display: "flex", borderRadius: 18, overflow: "hidden",
        border: "2px solid rgba(255,255,255,0.18)", boxShadow: "0 30px 80px rgba(0,0,0,0.55)", transform: "rotate(-3deg)", background: "#fff",
      }}
    >
      <img src={src} alt="" width={620} height={326} style={{ objectFit: "cover", objectPosition: "top left" }} />
    </div>
  );
}

// `emoji: false` draws an emoji glyph as its title's first letter, for a Mac with no network (twemoji is fetched).
export async function appCardImage(input: AppCardInput, opts: { emoji?: boolean; headers?: Record<string, string> } = {}): Promise<ImageResponse> {
  const emoji = opts.emoji ?? true;
  const { font, emblem } = await assets();
  const shot = input.shot ? imageDataUrl(input.shot) : null;
  const width = shot ? 560 : 1000;
  const title = cardTitle(input);
  return new ImageResponse(
    (
      <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", background: "#151a29", color: "#ece5d8", fontFamily: "Fraunces" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 1200, height: 630, background: "radial-gradient(circle at 85% 20%, rgba(240,153,95,0.22), rgba(21,26,41,0) 55%)" }} />
        {shot ? <Shot src={shot} /> : null}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, width: width + 128, height: 630 }}>
          <Glyph name={input.name} emoji={emoji} size={112} />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: title.length > 24 ? 60 : 76, lineHeight: 1.02, letterSpacing: -2 }}>{title}</div>
            {input.description ? (
              <div style={{ fontSize: 28, lineHeight: 1.35, color: "#d8d0c2", fontFamily: "sans-serif" }}>{input.description}</div>
            ) : null}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "#f0995f", fontFamily: "sans-serif" }}>
            <img src={emblem} alt="" width={36} height={36} />
            <div>{`${input.byline} · made with Weft`}</div>
          </div>
        </div>
      </div>
    ),
    { ...APP_CARD_SIZE, headers: opts.headers, fonts: [{ name: "Fraunces", data: font, style: "normal", weight: 500 }], ...(emoji ? { emoji: "twemoji" as const } : {}) },
  );
}
