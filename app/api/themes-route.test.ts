import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// app/api/themes and its picture route: lib/custom-themes.ts is mocked; the picture is a real temp file.
vi.mock("next/server", () => ({ connection: async () => {} }));
const themes = vi.hoisted(() => ({ listCustomThemes: vi.fn(), startThemeCard: vi.fn(), customThemePicture: vi.fn() }));
vi.mock("@/lib/custom-themes", () => themes);
vi.mock("@/lib/store", () => ({ getCard: (id: string) => ({ id, title: "Theme: neon" }) }));

const list = await import("./themes/route");
const picture = await import("./themes/[id]/picture/route");

const req = (method = "GET", body?: unknown) =>
  new Request("http://localhost:3457/api/themes", { method, headers: { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe("/api/themes", () => {
  it("lists the finished themes", async () => {
    themes.listCustomThemes.mockReturnValue([{ id: "neon" }]);
    expect(await (await list.GET(req())).json()).toEqual({ themes: [{ id: "neon" }] });
  });

  it("starts the thread that paints a new theme", async () => {
    themes.startThemeCard.mockReturnValue({ id: "neon", card: { id: "c1" } });
    const res = await list.POST(req("POST", { prompt: "neon rain" }));
    expect(themes.startThemeCard).toHaveBeenCalledWith("neon rain", undefined);
    expect(await res.json()).toEqual({ id: "neon", card: { id: "c1", title: "Theme: neon" } });
  });

  it("passes an empty prompt on, and answers with its error", async () => {
    themes.startThemeCard.mockImplementation(() => {
      throw new Error("Describe the theme you want.");
    });
    const res = await list.POST(req("POST", { prompt: 3 }));
    expect(themes.startThemeCard).toHaveBeenCalledWith("", undefined);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  const multipart = (form: FormData) =>
    new Request("http://localhost:3457/api/themes", { method: "POST", headers: { host: "localhost:3457", "x-weft-token": "1" }, body: form });

  it("takes your own picture as multipart, with its words and file name", async () => {
    themes.startThemeCard.mockReturnValue({ id: "beach", card: { id: "c2" } });
    const form = new FormData();
    form.set("prompt", "warm");
    form.set("picture", new File([new Uint8Array([0xff, 0xd8, 0xff])], "beach.jpg", { type: "image/jpeg" }));
    expect((await list.POST(multipart(form))).status).toBe(200);
    expect(themes.startThemeCard).toHaveBeenCalledWith("warm", { bytes: new Uint8Array([0xff, 0xd8, 0xff]), name: "beach.jpg" });
  });

  it("treats multipart without a picture as words alone", async () => {
    themes.startThemeCard.mockReturnValue({ id: "w", card: { id: "c3" } });
    const form = new FormData();
    form.set("prompt", "words");
    await list.POST(multipart(form));
    expect(themes.startThemeCard).toHaveBeenCalledWith("words", undefined);
  });
});

describe("/api/themes/[id]/picture", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-pic-"));

  it("serves the picture with its type", async () => {
    const file = path.join(dir, "picture.jpg");
    fs.writeFileSync(file, "jpg");
    themes.customThemePicture.mockReturnValue({ file, type: "image/jpeg" });
    const res = await picture.GET(req(), params("neon"));
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(await res.text()).toBe("jpg");
  });

  it("locks down an SVG so it can't run script", async () => {
    const file = path.join(dir, "picture.svg");
    fs.writeFileSync(file, "<svg/>");
    themes.customThemePicture.mockReturnValue({ file, type: "image/svg+xml" });
    const res = await picture.GET(req(), params("neon"));
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("404s a bad id, a theme without a picture, or a missing file", async () => {
    expect((await picture.GET(req(), params("../x"))).status).toBe(404);
    expect(themes.customThemePicture).not.toHaveBeenCalled();
    themes.customThemePicture.mockReturnValue(null);
    expect((await picture.GET(req(), params("neon"))).status).toBe(404);
    themes.customThemePicture.mockReturnValue({ file: path.join(dir, "gone.png"), type: "image/png" });
    expect((await picture.GET(req(), params("neon"))).status).toBe(404);
  });
});
