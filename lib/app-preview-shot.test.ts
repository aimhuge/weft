// lib/app-preview-capture.ts's picture: when a shared mini app's link preview gets its 1200x630 capture, and
// what happens when that capture fails. A failed capture keeps the last picture (the link still shows one) but
// leaves `shotFailedAt`, so the next tick tries again instead of the failure being lost.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type CaptureState,
  emptyCaptureState,
  LONG_PAGE,
  previewPage,
  sitePage as makeSitePage,
  stubSite,
} from "./app-preview-capture.test-helpers";

// vi.hoisted runs before the imports, so the state is spelled out here rather than filled in from a helper.
const state: CaptureState = vi.hoisted(() => ({
  shell: null,
  shellThrows: false,
  haiku: null,
  haikuThrows: false,
  uploaded: [] as string[],
  uploadRef: null,
  writes: [] as { row: Record<string, unknown>; filters: Record<string, unknown> }[],
  pendingRow: {},
  writeError: null,
  writeThrows: null,
}));

vi.mock("./browser-tools", () => ({
  shell: vi.fn(() =>
    state.shellThrows ? Promise.reject(new Error("no desktop app")) : Promise.resolve(state.shell ?? {}),
  ),
}));

vi.mock("./haiku", () => ({
  complete: vi.fn(() => Promise.resolve(state.haiku ?? "")),
}));

vi.mock("./blob-store", () => ({
  createBlobStore: () => ({
    upload: vi.fn(() => Promise.resolve(state.uploadRef)),
  }),
}));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "weft-preview-shot-"));
process.env.WEFT_DATA = path.join(tmp, "data");

const { buildPreview, refreshAppPreview, PREVIEW_RETRY_MS } = await import("./app-preview-capture");

const sitePage = () => makeSitePage(state);
const NOW = previewPage("site", "https://example.com/app");
const OLD_SHOT = `blob:sha256:${"c".repeat(64)}`;

beforeEach(() => {
  Object.assign(state, emptyCaptureState());
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("a preview's picture", () => {
  it("marks a failed capture, so the next tick tries again", async () => {
    state.shellThrows = true;
    stubSite(LONG_PAGE);
    const preview = await buildPreview(sitePage(), NOW, "o1", null);
    expect(preview.shot).toBeUndefined();
    expect(preview.shotFailedAt).toBeGreaterThan(0);
  });

  it("keeps the last picture when a fresh capture fails, and leaves the mark", async () => {
    state.shellThrows = true;
    stubSite(LONG_PAGE);
    const preview = await buildPreview(sitePage(), NOW, "o1", { of: "https://example.com/app", shot: OLD_SHOT });
    expect(preview.shot).toBe(OLD_SHOT);
    expect(preview.shotFailedAt).toBeGreaterThan(0);
  });

  it("leaves no mark when the capture worked", async () => {
    state.shell = { png: Buffer.from("png-bytes").toString("base64") };
    state.uploadRef = `blob:sha256:${"b".repeat(64)}`;
    stubSite(LONG_PAGE);
    const preview = await buildPreview(sitePage(), NOW, "o1", null);
    expect(preview.shot).toBe(`blob:sha256:${"b".repeat(64)}`);
    expect(preview.shotFailedAt).toBeUndefined();
  });

  it("keeps Haiku's sentence for the same page, without asking again", async () => {
    const { complete } = await import("./haiku");
    vi.mocked(complete).mockClear();
    state.haiku = "It shows the growth of a small product.";
    stubSite(LONG_PAGE);
    const last = {
      of: "https://example.com/app",
      description: "It shows the growth of a small product.",
      by: { description: "weft" as const },
    };
    const preview = await buildPreview(sitePage(), NOW, "o1", last);
    expect(preview.description).toBe("It shows the growth of a small product.");
    expect(preview.by?.description).toBe("weft");
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("refreshAppPreview after a failed capture", () => {
  it("makes one again once the retry time has passed, even with the old picture there", async () => {
    stubSite("<p>text</p>");
    const failed = {
      of: "https://example.com/app",
      at: Date.now() - 1000,
      shot: OLD_SHOT,
      shotFailedAt: Date.now() - PREVIEW_RETRY_MS - 1000,
    };
    await refreshAppPreview(sitePage(), { id: "row1", preview: failed }, NOW);
    expect(state.writes).toHaveLength(1);
  });

  it("leaves it alone before the retry time", async () => {
    const fetchMock = stubSite("<p>text</p>");
    const failed = {
      of: "https://example.com/app",
      at: Date.now() - 1000,
      shot: OLD_SHOT,
      shotFailedAt: Date.now() - PREVIEW_RETRY_MS + 60_000,
    };
    await refreshAppPreview(sitePage(), { id: "row1", preview: failed }, NOW);
    expect(state.writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
