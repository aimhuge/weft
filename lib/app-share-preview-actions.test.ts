import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/app-share-preview-actions.ts: what the Share dialog shows for a shared mini app's link preview.
// The app's own picture (a folder app's file on disk, or the https address the page named), else the branded
// card drawn from this Mac's capture, with the owner's name on it. The share's own row, the owners list and
// the capture are mocked; the folder's picture is a real file.

interface Owners {
  user: { username: string } | null;
  orgs: { id: string; slug: string; name: string }[];
}

interface State {
  target: unknown;
  row: unknown;
  now: unknown;
  owners: Owners;
  described: { appId: string; text: string | null }[];
  refreshed: { appId: string }[];
  cardFails: number;
  cardCalls: { input: unknown; opts: unknown }[];
}

const state: State = vi.hoisted(() => ({
  target: null,
  row: null,
  now: null,
  owners: { user: { username: "alice" }, orgs: [] },
  described: [],
  refreshed: [],
  cardFails: 0,
  cardCalls: [],
}));

vi.mock("./app-share", async () => {
  // The real error class, so the route's status passthrough is the same type.
  const { AppShareError } = await import("./app-share-errors");
  return {
    AppShareError,
    target: vi.fn(() => Promise.resolve(state.target)),
    getAppShare: vi.fn(() =>
      Promise.resolve({ kind: "ok", id: "s1", url: "https://weft.zip/a/s1", mode: "public", hasPassword: false, shows: "site" }),
    ),
  };
});

vi.mock("./app-share-row", () => ({
  readShare: vi.fn(() => Promise.resolve(state.row)),
  currentPage: vi.fn(() => Promise.resolve(state.now)),
}));

vi.mock("./app-preview-capture", () => ({
  setPreviewDescription: vi.fn((_t: unknown, _row: unknown, _now: unknown, text: string | null) => {
    state.described.push({ appId: "app1", text });
    return Promise.resolve();
  }),
  refreshAppPreview: vi.fn(() => {
    state.refreshed.push({ appId: "app1" });
    return Promise.resolve();
  }),
  shotPath: (appId: string) => path.join(process.env.WEFT_DATA ?? "/tmp", "app-previews", `${appId}.png`),
}));

vi.mock("./app-share-owners", () => ({
  listOwners: vi.fn(() => Promise.resolve(state.owners)),
}));

vi.mock("./app-card-image", () => ({
  imageDataUrl: (bytes: ArrayBuffer) => `data:image/png;base64,${Buffer.from(new Uint8Array(bytes)).toString("base64")}`,
  appCardImage: vi.fn((input: unknown, opts: unknown) => {
    state.cardCalls.push({ input, opts });
    // The emoji glyph is fetched from twemoji: offline, the first call fails and the
    // fallback (the title's first letter) is used.
    if (state.cardFails > 0) {
      state.cardFails -= 1;
      return Promise.reject(new Error("no network"));
    }
    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer),
    });
  }),
}));

const { AppShareError } = await import("./app-share");
const { describeApp, previewCard, refreshPreview } = await import("./app-share-preview-actions");
const { appCardImage } = await import("./app-card-image");
const { listOwners } = await import("./app-share-owners");
const { readShare, currentPage } = await import("./app-share-row");
const { refreshAppPreview, setPreviewDescription } = await import("./app-preview-capture");

const APP = { id: "app1", name: "📈 Growth", url: "https://example.com/app" };

function ready(page: unknown): never {
  return { client: {}, orgId: "o1", userId: "u1", app: APP, page } as never;
}

let sandbox: string;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "weft-preview-actions-"));
  // The capture of the app lives beside the board's data: a leftover from an earlier case would
  // turn the "no capture" case into one with a capture.
  fs.rmSync(path.join(process.env.WEFT_DATA ?? "/tmp", "app-previews", "app1.png"), { force: true });
  state.target = ready({ kind: "site", url: "https://example.com/app" });
  state.row = {
    id: "row1",
    mode: "public",
    has_password: false,
    name: "Growth",
    kind: "site",
    page: "https://example.com/app",
    owner: "user",
    slug: "growth",
    files: null,
    manifest: null,
    org_id: "o1",
  };
  state.now = { kind: "site", page: "https://example.com/app", files: null, manifest: null };
  state.owners = { user: { username: "alice" }, orgs: [] };
  state.described = [];
  state.refreshed = [];
  state.cardFails = 0;
  state.cardCalls = [];
  vi.mocked(appCardImage).mockClear();
  vi.mocked(listOwners).mockClear();
  vi.mocked(readShare).mockClear();
  vi.mocked(currentPage).mockClear();
  vi.mocked(refreshAppPreview).mockClear();
  vi.mocked(setPreviewDescription).mockClear();
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("the share has to exist", () => {
  it("refuses an app that can't be shared", async () => {
    state.target = { kind: "blocked", state: { kind: "signed-out" } };
    await expect(describeApp("app1", "words")).rejects.toBeInstanceOf(AppShareError);
    await expect(describeApp("app1", "words")).rejects.toMatchObject({ status: 400, message: "Share this app first." });
    await expect(refreshPreview("app1")).rejects.toMatchObject({ status: 400, message: "Share this app first." });
    await expect(previewCard("app1")).rejects.toMatchObject({ status: 400, message: "Share this app first." });
    expect(readShare).not.toHaveBeenCalled();
  });

  it("refuses an app with no share row", async () => {
    state.row = null;
    await expect(describeApp("app1", "words")).rejects.toMatchObject({ status: 400, message: "Share this app first." });
    await expect(refreshPreview("app1")).rejects.toMatchObject({ status: 400, message: "Share this app first." });
    await expect(previewCard("app1")).rejects.toMatchObject({ status: 400, message: "Share this app first." });
  });
});

describe("describeApp", () => {
  it("saves what you typed and answers the share's state", async () => {
    const state0 = await describeApp("app1", "My own words.");
    expect(setPreviewDescription).toHaveBeenCalledTimes(1);
    const args = vi.mocked(setPreviewDescription).mock.calls[0]?.[3];
    expect(args).toBe("My own words.");
    expect(state0).toMatchObject({ kind: "ok", id: "s1" });
  });
});

describe("refreshPreview", () => {
  it("makes a fresh preview and answers the share's state", async () => {
    const state0 = await refreshPreview("app1");
    expect(refreshAppPreview).toHaveBeenCalledTimes(1);
    // The refresh is forced: the page hasn't changed, but you asked.
    expect(vi.mocked(refreshAppPreview).mock.calls[0]?.[3]).toBe(true);
    expect(state0).toMatchObject({ kind: "ok", id: "s1" });
  });
});

describe("previewCard", () => {
  it("has nothing to show when the row has no preview", async () => {
    state.row = { ...(state.row as Record<string, unknown>), preview: null };
    expect(await previewCard("app1")).toEqual({ image: null, preview: null });
    expect(appCardImage).not.toHaveBeenCalled();
  });

  it("shows the https picture the page named, as it is", async () => {
    state.row = {
      ...(state.row as Record<string, unknown>),
      preview: { title: "Growth", description: "A thing.", image: "https://cdn.example.com/a.png" },
    };
    const out = await previewCard("app1");
    expect(out.image).toBe("https://cdn.example.com/a.png");
    expect(out.preview?.image).toBe("https://cdn.example.com/a.png");
    expect(appCardImage).not.toHaveBeenCalled();
  });

  it("shows a folder app's own picture from the folder on disk", async () => {
    const folder = path.join(sandbox, "app");
    fs.mkdirSync(folder, { recursive: true });
    const sha = "a".repeat(64);
    fs.writeFileSync(path.join(folder, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    state.target = ready({ kind: "folder", folder, entry: "index.html", files: [], manifest: {} });
    state.now = { kind: "folder", page: "index.html", files: { "logo.png": sha }, manifest: null };
    state.row = {
      ...(state.row as Record<string, unknown>),
      preview: { title: "Growth", image: `blob:sha256:${sha}` },
    };
    const out = await previewCard("app1");
    expect(out.image).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64")}`);
    expect(appCardImage).not.toHaveBeenCalled();
  });

  it("draws the branded card, with the owner's name on it", async () => {
    state.row = {
      ...(state.row as Record<string, unknown>),
      preview: { title: "Growth", description: "A thing." },
    };
    const out = await previewCard("app1");
    expect(out.image).toBe("data:image/png;base64,iVBORw==");
    expect(out.preview).toMatchObject({ title: "Growth", description: "A thing." });
    const input = vi.mocked(appCardImage).mock.calls[0]?.[0] as { name: string; title?: string; byline: string; shot?: ArrayBuffer | null };
    expect(input.name).toBe("📈 Growth");
    expect(input.title).toBe("Growth");
    expect(input.byline).toBe("@alice");
    expect(input.shot).toBeNull();
  });

  it("puts the capture of the app in the card when there is one", async () => {
    const shotFile = path.join(process.env.WEFT_DATA ?? "/tmp", "app-previews", "app1.png");
    fs.mkdirSync(path.dirname(shotFile), { recursive: true });
    fs.writeFileSync(shotFile, Buffer.from([1, 2, 3, 4]));
    state.row = {
      ...(state.row as Record<string, unknown>),
      preview: { title: "Growth", shot: `blob:sha256:${"b".repeat(64)}` },
    };
    await previewCard("app1");
    const input = vi.mocked(appCardImage).mock.calls[0]?.[0] as { shot?: ArrayBuffer | null };
    expect(input.shot).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(input.shot as ArrayBuffer).toString("utf8")).toBe("\u0001\u0002\u0003\u0004");
  });

  it("draws the card without a capture when the file isn't there", async () => {
    state.row = {
      ...(state.row as Record<string, unknown>),
      preview: { title: "Growth", shot: `blob:sha256:${"b".repeat(64)}` },
    };
    await previewCard("app1");
    const input = vi.mocked(appCardImage).mock.calls[0]?.[0] as { shot?: ArrayBuffer | null };
    expect(input.shot).toBeNull();
  });

  it("names the workspace when the link is the workspace's", async () => {
    state.owners = {
      user: { username: "alice" },
      orgs: [{ id: "o2", slug: "team", name: "The Team" }],
    };
    state.row = {
      ...(state.row as Record<string, unknown>),
      owner: "org",
      org_id: "o2",
      preview: { title: "Growth" },
    };
    await previewCard("app1");
    const input = vi.mocked(appCardImage).mock.calls[0]?.[0] as { byline: string };
    expect(input.byline).toBe("The Team");
  });

  it("says weft.zip when the workspace isn't one of the owner's, or there's no profile", async () => {
    state.owners = { user: null, orgs: [] };
    state.row = {
      ...(state.row as Record<string, unknown>),
      owner: "org",
      org_id: "o2",
      preview: { title: "Growth" },
    };
    await previewCard("app1");
    let input = vi.mocked(appCardImage).mock.calls[0]?.[0] as { byline: string };
    expect(input.byline).toBe("weft.zip");

    vi.mocked(appCardImage).mockClear();
    state.owners = { user: null, orgs: [] };
    state.row = {
      ...(state.row as Record<string, unknown>),
      owner: "user",
      preview: { title: "Growth" },
    };
    await previewCard("app1");
    input = vi.mocked(appCardImage).mock.calls[0]?.[0] as { byline: string };
    expect(input.byline).toBe("weft.zip");
  });

  it("falls back to the letter glyph when the emoji can't be fetched", async () => {
    state.cardFails = 1;
    state.row = {
      ...(state.row as Record<string, unknown>),
      preview: { title: "Growth" },
    };
    const out = await previewCard("app1");
    expect(out.image).toBe("data:image/png;base64,iVBORw==");
    // The first call tried with the emoji, the second without it.
    expect(state.cardCalls).toHaveLength(2);
    expect(state.cardCalls[1]?.opts).toEqual({ emoji: false });
  });

  it("reads the page under the sharer's own workspace when the row names none", async () => {
    const row = { ...(state.row as Record<string, unknown>) };
    delete row.org_id;
    state.row = row;
    state.row = { ...row, preview: { title: "Growth" } };
    await previewCard("app1");
    // currentPage is asked for the page under the context's own workspace.
    expect(vi.mocked(currentPage).mock.calls[0]?.[2]).toBe("o1");
  });
});
