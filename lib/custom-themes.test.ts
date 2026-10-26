import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const newCard = vi.hoisted(() => ({
  createCardFromBody: vi.fn((body: Record<string, unknown>) => ({ id: "card-1", ...body })),
  startCard: vi.fn(() => ({ started: true })),
}));
vi.mock("./new-card", () => newCard);
vi.mock("./settings", () => ({ defaultBackend: () => "claude" }));

import {
  MAX_PICTURE_BYTES,
  customThemePicture,
  listCustomThemes,
  readCustomTheme,
  startThemeCard,
  themeCardPrompt,
  themesDir,
  uploadedPictureName,
} from "./custom-themes";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

const COLORS = { canvas: "#000", ink: "#fff", accent: "#f0f" };

function writeTheme(id: string, json: unknown, picture?: string, mtime?: number) {
  const dir = path.join(themesDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "theme.json"), typeof json === "string" ? json : JSON.stringify(json));
  if (picture) fs.writeFileSync(path.join(dir, picture), "img");
  if (mtime) fs.utimesSync(dir, mtime, mtime);
}

beforeEach(() => {
  fs.rmSync(themesDir(), { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("listCustomThemes", () => {
  it("is empty with no themes folder", () => {
    expect(listCustomThemes()).toEqual([]);
  });

  it("lists finished themes newest first and skips ones still being painted", () => {
    writeTheme("old", { label: "Old", colors: COLORS }, undefined, 1000);
    writeTheme("new", { label: "New", colors: COLORS }, "picture.png", 2000);
    writeTheme("broken", "{not json");
    fs.mkdirSync(path.join(themesDir(), "painting"));
    expect(listCustomThemes().map((t) => t.id)).toEqual(["new", "old"]);
    expect(readCustomTheme("new")?.picture).toBe("picture.png");
  });
});

describe("customThemePicture", () => {
  it("finds the picture and its type", () => {
    writeTheme("p", { colors: COLORS }, "picture.svg");
    expect(customThemePicture("p")).toEqual({ file: path.join(themesDir(), "p", "picture.svg"), type: "image/svg+xml" });
  });

  it("is null without a picture or a theme", () => {
    writeTheme("bare", { colors: COLORS });
    expect(customThemePicture("bare")).toBeNull();
    expect(customThemePicture("nope")).toBeNull();
  });
});

describe("startThemeCard", () => {
  it("makes the folder and starts a theme card in the themes folder", async () => {
    const { id } = await startThemeCard("  Rainy Tokyo alley at night ");
    expect(id).toBe("rainy-tokyo-alley");
    expect(fs.existsSync(path.join(themesDir(), id))).toBe(true);
    const body = vi.mocked(newCard.createCardFromBody).mock.calls[0]![0];
    expect(body).toMatchObject({ title: "Theme: Rainy Tokyo alley at night", cwd: themesDir(), backend: "claude", tags: ["theme"] });
    expect(body.prompt).toContain(path.join(themesDir(), id));
    expect(newCard.startCard).toHaveBeenCalled();
    expect((await startThemeCard("rainy tokyo alley")).id).toBe("rainy-tokyo-alley-2");
  });

  it("refuses an empty description", async () => {
    await expect(startThemeCard("   ")).rejects.toThrow("Describe the theme");
  });
});

describe("themeCardPrompt", () => {
  it("asks for the picture and the theme.json shape", () => {
    const prompt = themeCardPrompt('neon "rain"', "neon", "/t/neon");
    expect(prompt).toContain("/t/neon/");
    expect(prompt).toContain("picture.svg");
    expect(prompt).toContain('"prompt": "neon \\"rain\\""');
  });
});

describe("uploadedPictureName", () => {
  it("knows a JPEG, PNG or WebP by its bytes", () => {
    expect(uploadedPictureName(JPEG)).toBe("picture.jpg");
    expect(uploadedPictureName(PNG)).toBe("picture.png");
    expect(uploadedPictureName(WEBP)).toBe("picture.webp");
  });

  it("refuses anything else, an SVG included", () => {
    expect(uploadedPictureName(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(uploadedPictureName(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(uploadedPictureName(new Uint8Array())).toBeNull();
  });
});

describe("startThemeCard with your picture", () => {
  const brief = () => String(vi.mocked(newCard.createCardFromBody).mock.calls.at(-1)![0].prompt);

  it("saves the picture first and briefs the thread to build around it", async () => {
    const { id } = await startThemeCard("warm and quiet", { bytes: PNG, name: "beach.png" });
    expect(id).toBe("warm-and-quiet");
    expect(fs.readFileSync(path.join(themesDir(), id, "picture.png"))).toEqual(Buffer.from(PNG));
    expect(brief()).toContain(`${path.join(themesDir(), id)}/picture.png, which I uploaded`);
    expect(brief()).toContain('with this in mind: "warm and quiet"');
  });

  it("needs no words: the file's name names it, else 'picture'", async () => {
    expect((await startThemeCard("", { bytes: JPEG, name: "Sunset Beach.JPG" })).id).toBe("sunset-beach");
    expect(vi.mocked(newCard.createCardFromBody).mock.calls[0]![0].title).toBe("Theme: from your picture");
    expect(brief()).toContain("around the picture I uploaded.");
    expect((await startThemeCard(" ", { bytes: WEBP })).id).toBe("picture");
    expect(fs.existsSync(path.join(themesDir(), "picture", "picture.webp"))).toBe(true);
  });

  it("refuses a picture too big or not a photo, before making a folder", async () => {
    await expect(startThemeCard("x", { bytes: new Uint8Array(MAX_PICTURE_BYTES + 1) })).rejects.toThrow("over 20 MB");
    await expect(startThemeCard("x", { bytes: new TextEncoder().encode("<svg/>") })).rejects.toThrow("JPEG, PNG or WebP");
    expect(fs.existsSync(themesDir())).toBe(false);
    expect(newCard.startCard).not.toHaveBeenCalled();
  });
});

describe("themeCardPrompt around a picture", () => {
  it("keeps the picture, leans on the scrim, and only asks for theme.json", () => {
    const prompt = themeCardPrompt("", "mine", "/t/mine", "picture.jpg");
    expect(prompt).toContain("/t/mine/picture.jpg");
    expect(prompt).toContain("Keep it exactly as it is");
    expect(prompt).toContain("the scrim does the work");
    expect(prompt).not.toContain("picture.svg");
    expect(prompt).toContain("edit theme.json; the picture stays mine");
  });
});
