// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

// api.themeFromPicture: a theme around your own picture, sent as multipart (lib/client-api.ts).
function respond(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: init.status ?? 200, statusText: init.statusText })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const lastCall = (fetch: ReturnType<typeof respond>) => fetch.mock.lastCall as unknown as [string, RequestInit];

afterEach(() => vi.unstubAllGlobals());

describe("api.themeFromPicture", () => {
  it("posts the words and picture as multipart with the token", async () => {
    const fetch = respond({ id: "beach", card: { id: "c1" } });
    const picture = new File(["x"], "beach.jpg", { type: "image/jpeg" });
    await expect(api.themeFromPicture("warm", picture)).resolves.toEqual({ id: "beach", card: { id: "c1" } });
    const [url, init] = lastCall(fetch);
    expect(url).toBe("/api/themes");
    expect(init).toMatchObject({ method: "POST", headers: { "x-weft-token": "1" } });
    const form = init.body as FormData;
    expect(form.get("prompt")).toBe("warm");
    expect((form.get("picture") as File).name).toBe("beach.jpg");
  });

  it("throws the server's error, the status text, or the status", async () => {
    const picture = new File(["x"], "a.png");
    respond({ error: "Use a JPEG, PNG or WebP picture." }, { status: 400 });
    await expect(api.themeFromPicture("", picture)).rejects.toThrow("Use a JPEG");
    respond({}, { status: 413, statusText: "Too Large" });
    await expect(api.themeFromPicture("", picture)).rejects.toThrow("Too Large");
    respond({}, { status: 500 });
    await expect(api.themeFromPicture("", picture)).rejects.toThrow("Request failed (500).");
  });
});
