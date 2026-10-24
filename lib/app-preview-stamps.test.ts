// lib/app-preview.ts's two timestamps: when a preview was made (`at`) and when its last capture failed
// (`shotFailedAt`). They're what lib/app-preview-capture.ts's isStale judges freshness by, so a row that
// holds something else (a string, a negative number, NaN) has to be read as "no stamp at all".
import { describe, expect, it } from "vitest";

const { cleanPreview, mergePreview } = await import("./app-preview");

const AT = 1_700_000_000_000;

describe("a preview's stamps", () => {
  it("carries them through a merge", () => {
    const preview = mergePreview({ of: "https://example.com/page", at: AT, shotFailedAt: AT + 1000 });
    expect(preview.at).toBe(AT);
    expect(preview.shotFailedAt).toBe(AT + 1000);
  });

  it("keeps a whole number, rounded", () => {
    expect(cleanPreview({ at: AT })).toEqual({ at: AT });
    expect(cleanPreview({ at: AT + 0.6 })).toEqual({ at: AT + 1 });
    expect(cleanPreview({ shotFailedAt: AT })).toEqual({ shotFailedAt: AT });
    expect(cleanPreview({ shotFailedAt: AT + 0.4 })).toEqual({ shotFailedAt: AT });
  });

  it("drops one that isn't a number", () => {
    expect(cleanPreview({ at: "1700000000000" })).toBeNull();
    expect(cleanPreview({ at: -1 })).toBeNull();
    expect(cleanPreview({ at: 0 })).toBeNull();
    expect(cleanPreview({ at: Number.NaN })).toBeNull();
    expect(cleanPreview({ at: Number.POSITIVE_INFINITY })).toBeNull();
    expect(cleanPreview({ shotFailedAt: "1700000000000" })).toBeNull();
    expect(cleanPreview({ shotFailedAt: -1 })).toBeNull();
    expect(cleanPreview({ shotFailedAt: 0 })).toBeNull();
    expect(cleanPreview({ shotFailedAt: Number.NaN })).toBeNull();
    expect(cleanPreview({ shotFailedAt: Number.POSITIVE_INFINITY })).toBeNull();
  });
});
