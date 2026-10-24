// lib/app-preview-capture.ts's isStale: when a shared mini app's link preview needs making again. It's a pure
// rule, so it lives in its own file beside the capture's tests: a changed page, a preview that's grown old, or
// one that should have a picture and hasn't got one.

import { describe, expect, it } from "vitest";

const { isStale, PREVIEW_MAX_AGE_MS, PREVIEW_RETRY_MS } = await import("./app-preview-capture");

describe("isStale", () => {
  const key = "https://example.com/app";
  const now = 1_700_000_000_000;

  it("is stale when there's no preview, or the page changed", () => {
    expect(isStale(null, key, now)).toBe(true);
    expect(isStale({ of: "https://example.com/other", at: now }, key, now)).toBe(true);
  });

  it("is stale when the preview has no timestamp to judge it by", () => {
    expect(isStale({ of: key }, key, now)).toBe(true);
  });

  it("is fresh while it's younger than PREVIEW_MAX_AGE_MS", () => {
    expect(isStale({ of: key, at: now - PREVIEW_MAX_AGE_MS + 1000, shot: "blob:sha256:x" }, key, now)).toBe(false);
  });

  it("is stale once it passes PREVIEW_MAX_AGE_MS", () => {
    expect(isStale({ of: key, at: now - PREVIEW_MAX_AGE_MS, shot: "blob:sha256:x" }, key, now)).toBe(true);
  });

  it("is stale sooner when there's no picture to show", () => {
    expect(isStale({ of: key, at: now - PREVIEW_RETRY_MS - 1000 }, key, now)).toBe(true);
    expect(isStale({ of: key, at: now - PREVIEW_RETRY_MS + 1000 }, key, now)).toBe(false);
  });

  it("keeps a preview with its own picture past the retry time", () => {
    expect(isStale({ of: key, at: now - PREVIEW_RETRY_MS - 1000, image: "https://example.com/a.png" }, key, now)).toBe(false);
  });

  it("is stale once the last capture failed long enough ago, picture or not", () => {
    const failed = { of: key, at: now - 1000, shot: "blob:sha256:x", shotFailedAt: now - PREVIEW_RETRY_MS - 1000 };
    expect(isStale(failed, key, now)).toBe(true);
  });

  it("leaves a failed capture alone before the retry time", () => {
    const failed = { of: key, at: now - 1000, shot: "blob:sha256:x", shotFailedAt: now - PREVIEW_RETRY_MS + 1000 };
    expect(isStale(failed, key, now)).toBe(false);
  });
});
