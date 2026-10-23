import { beforeEach, describe, expect, it, vi } from "vitest";

// The two routes that make and show a shared mini app's link preview:
//   GET/PUT/POST /api/apps/share/preview — the Share dialog's card, your own description, Refresh preview.
//   GET /api/a/[id]/og                — the picture a public link unfurls as on weft.zip.
//
// The share's own lib and the card's picture are mocked; the localhost guard is the real one, so the
// routes' own refusals are exercised too.

interface State {
  denied: boolean;
  card: { image: string | null; preview: unknown };
  cardThrows: Error | null;
  described: { appId: string; text: string | null }[];
  refreshed: string[];
  share: unknown;
  service: unknown;
  bytes: ArrayBuffer | null;
  byline: string;
  cardImageCalls: { input: unknown; opts: unknown }[];
}

const state: State = vi.hoisted(() => ({
  denied: false,
  card: { image: null, preview: null },
  cardThrows: null,
  described: [],
  refreshed: [],
  share: null,
  service: null,
  bytes: null,
  byline: "weft.zip",
  cardImageCalls: [],
}));

vi.mock("next/server", () => ({ connection: async () => {} }));

vi.mock("@/lib/guard", () => ({
  guard: () => (state.denied ? Response.json({ error: "Forbidden host" }, { status: 403 }) : null),
  fail: (err: unknown, status = 400) =>
    Response.json({ error: err instanceof Error ? err.message : String(err) }, { status }),
}));

vi.mock("@/lib/app-share", async () => {
  const { AppShareError } = await import("@/lib/app-share-errors");
  return { AppShareError };
});

vi.mock("@/lib/app-share-preview-actions", () => ({
  previewCard: vi.fn(() => {
    if (state.cardThrows) return Promise.reject(state.cardThrows);
    return Promise.resolve(state.card);
  }),
  describeApp: vi.fn((appId: string, text: string | null) => {
    if (state.cardThrows) return Promise.reject(state.cardThrows);
    state.described.push({ appId, text });
    return Promise.resolve({ kind: "ok", id: "s1" });
  }),
  refreshPreview: vi.fn((appId: string) => {
    if (state.cardThrows) return Promise.reject(state.cardThrows);
    state.refreshed.push(appId);
    return Promise.resolve({ kind: "ok", id: "s1" });
  }),
}));

vi.mock("@/lib/app-card-image", () => ({
  appCardImage: vi.fn((input: unknown, opts: unknown) => {
    state.cardImageCalls.push({ input, opts });
    return Promise.resolve(new Response("card-image", { headers: { "Content-Type": "image/png" } }));
  }),
  imageType: (bytes: ArrayBuffer) => {
    const b = new Uint8Array(bytes.slice(0, 12));
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    return null;
  },
}));

vi.mock("@/lib/app-share-access", () => ({
  loadAppShare: vi.fn(() => Promise.resolve(state.share)),
}));

vi.mock("@/lib/app-share-meta", async () => {
  // The real cleanPreview (lib/app-preview.ts), so the mock's verdict on a row's preview is the
  // server's own: a public share with nothing to show gets an empty preview, not a null one.
  const { cleanPreview } = await import("@/lib/app-preview");
  return {
    publicPreview: (share: { mode: string; preview?: unknown } | null) =>
      share?.mode === "public" ? cleanPreview(share.preview) ?? {} : null,
    blobBytes: vi.fn(() => Promise.resolve(state.bytes)),
    shareByline: vi.fn(() => Promise.resolve(state.byline)),
  };
});

vi.mock("@/lib/web-session", () => ({
  serviceClient: () => state.service,
}));

const { AppShareError } = await import("@/lib/app-share");
const previewRoute = await import("./apps/share/preview/route");
const ogRoute = await import("./a/[id]/og/route");

const READ = { host: "localhost:3457" };
const WRITE = { host: "localhost:3457", "x-weft-token": "1", "content-type": "application/json" };

// The asymmetric matchers come back as `any`; these wrappers keep them typed, so an assertion
// built from one is an ordinary object again.
const objectContaining = (sample: Record<string, unknown>) =>
  expect.objectContaining(sample) as unknown as Record<string, unknown>;
const stringContaining = (sample: string) => expect.stringContaining(sample) as unknown as string;
const anything = () => expect.anything() as unknown;
const get = (url = "http://localhost:3457/api/apps/share/preview?id=ap1") =>
  previewRoute.GET(new Request(url, { headers: READ }));
const put = (body: unknown, headers: Record<string, string> = WRITE) =>
  previewRoute.PUT(
    new Request("http://localhost:3457/api/apps/share/preview", {
      method: "PUT",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const post = (body: unknown) =>
  previewRoute.POST(
    new Request("http://localhost:3457/api/apps/share/preview", {
      method: "POST",
      headers: WRITE,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  state.denied = false;
  state.card = { image: null, preview: null };
  state.cardThrows = null;
  state.described = [];
  state.refreshed = [];
  state.share = null;
  state.service = {};
  state.bytes = null;
  state.byline = "weft.zip";
  state.cardImageCalls = [];
});

describe("GET /api/apps/share/preview", () => {
  it("answers the card a chat would show", async () => {
    state.card = { image: "data:image/png;base64,iVBORw==", preview: { title: "Growth" } };
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: "data:image/png;base64,iVBORw==", preview: { title: "Growth" } });
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    expect((await get()).status).toBe(403);
  });

  it("needs an id", async () => {
    const res = await get("http://localhost:3457/api/apps/share/preview");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Send ?id=." });
  });

  it("passes a refusal's status through", async () => {
    state.cardThrows = new AppShareError("Share this app first.", 400);
    const res = await get();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Share this app first." });
  });

  it("turns other errors into 500", async () => {
    state.cardThrows = new Error("supabase down");
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "supabase down" });
  });
});

describe("PUT /api/apps/share/preview", () => {
  it("saves your description and answers the share's state", async () => {
    const res = await put({ id: "ap1", description: "My own words." });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "ok", id: "s1" });
    expect(state.described).toEqual([{ appId: "ap1", text: "My own words." }]);
  });

  it("takes a null description, which hands it back to the page", async () => {
    const res = await put({ id: "ap1", description: null });
    expect(res.status).toBe(200);
    expect(state.described).toEqual([{ appId: "ap1", text: null }]);
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    expect((await put({ id: "ap1", description: "x" })).status).toBe(403);
  });

  it("needs a body with an id and a description", async () => {
    const noBody = await put("not json");
    expect(noBody.status).toBe(400);
    expect(await noBody.json()).toEqual({ error: "Send { id, description }." });

    const noId = await put({ description: "x" });
    expect(noId.status).toBe(400);
    expect(await noId.json()).toEqual({ error: "Send { id, description }." });

    const badDescription = await put({ id: "ap1", description: 42 });
    expect(badDescription.status).toBe(400);
    expect(await badDescription.json()).toEqual({ error: "Send { id, description }." });
  });

  it("passes a refusal's status through, and turns other errors into 500", async () => {
    state.cardThrows = new AppShareError("Share this app first.", 400);
    const refused = await put({ id: "ap1", description: "x" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "Share this app first." });

    state.cardThrows = new Error("supabase down");
    const broken = await put({ id: "ap1", description: "x" });
    expect(broken.status).toBe(500);
    expect(await broken.json()).toEqual({ error: "supabase down" });
  });
});

describe("POST /api/apps/share/preview", () => {
  it("makes the preview again and answers the share's state", async () => {
    const res = await post({ id: "ap1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ kind: "ok", id: "s1" });
    expect(state.refreshed).toEqual(["ap1"]);
  });

  it("refuses a request the guard denies", async () => {
    state.denied = true;
    expect((await post({ id: "ap1" })).status).toBe(403);
  });

  it("needs a body with an id", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Send { id }." });

    const noId = await post({ mode: "public" });
    expect(noId.status).toBe(400);
    expect(await noId.json()).toEqual({ error: "Send { id }." });
  });

  it("passes a refusal's status through, and turns other errors into 500", async () => {
    state.cardThrows = new AppShareError("Share this app first.", 400);
    const refused = await post({ id: "ap1" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "Share this app first." });

    state.cardThrows = new Error("supabase down");
    const broken = await post({ id: "ap1" });
    expect(broken.status).toBe(500);
    expect(await broken.json()).toEqual({ error: "supabase down" });
  });
});

describe("GET /api/a/[id]/og", () => {
  const og = (id = "abcdefghijklmnopqrstuv") =>
    ogRoute.GET(new Request(`http://localhost:3457/api/a/${id}/og`), { params: Promise.resolve({ id }) });

  it("says so when sharing isn't set up on this server", async () => {
    state.service = null;
    const res = await og();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Sharing isn't set up on this server.");
  });

  it("is a 404 for a share that isn't there, or isn't public", async () => {
    state.share = null;
    expect((await og()).status).toBe(404);

    state.share = { id: "s1", name: "Growth", mode: "private", preview: { title: "Growth" }, org_id: "o1" };
    expect((await og()).status).toBe(404);

    state.share = { id: "s1", name: "Growth", mode: "email", preview: { title: "Growth" }, org_id: "o1" };
    expect((await og()).status).toBe(404);
  });

  it("draws the plain card for a public share with nothing to show", async () => {
    state.share = { id: "s1", name: "Growth", mode: "public", preview: null, org_id: "o1" };
    const res = await og();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("card-image");
    expect(state.cardImageCalls[0]?.input).toMatchObject({ name: "Growth" });
  });

  it("serves the folder app's own picture with its type", async () => {
    const sha = "a".repeat(64);
    state.share = {
      id: "s1",
      name: "Growth",
      mode: "public",
      preview: { title: "Growth", image: `blob:sha256:${sha}` },
      org_id: "o1",
    };
    state.bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer;
    const res = await og();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    expect(state.cardImageCalls).toEqual([]);
  });

  it("draws the branded card when the app has no picture of its own", async () => {
    state.share = {
      id: "s1",
      name: "Growth",
      mode: "public",
      preview: { title: "Growth", description: "A thing." },
      org_id: "o1",
    };
    state.byline = "@alice";
    const res = await og();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("card-image");
    const call = state.cardImageCalls[0];
    expect(call?.input).toMatchObject({ name: "Growth", title: "Growth", description: "A thing.", byline: "@alice" });
    expect(call?.opts).toMatchObject({ headers: objectContaining({ "Cache-Control": stringContaining("max-age") }) });
  });

  it("puts the capture of the app in the card when there is one", async () => {
    const sha = "b".repeat(64);
    state.share = {
      id: "s1",
      name: "Growth",
      mode: "public",
      preview: { title: "Growth", shot: `blob:sha256:${sha}` },
      org_id: "o1",
    };
    state.bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    await og();
    const call = state.cardImageCalls[0];
    expect(call?.input).toMatchObject({ shot: anything() });
  });
});
