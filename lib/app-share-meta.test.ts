// lib/app-share-meta.ts: what a shared mini app's link unfurls as on weft.zip — the page's metadata, the
// card's picture, the byline and the blob behind it. The service client and the row loader are mocked:
// this module only decides what a link shows, and a private link must show nothing of the app.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { serviceClient: serviceClientMock, loadAppShare: loadAppShareMock, loadAppShareBySlug: loadAppShareBySlugMock } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  loadAppShare: vi.fn(),
  loadAppShareBySlug: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({ serviceClient: serviceClientMock }));
vi.mock("./app-share-access", () => ({ loadAppShare: loadAppShareMock, loadAppShareBySlug: loadAppShareBySlugMock }));

import {
  appMetadataById,
  appMetadataBySlug,
  appShareMetadata,
  blobBytes,
  cardVersion,
  GENERIC_APP_METADATA,
  previewImageUrl,
  publicPreview,
  shareByline,
} from "./app-share-meta";
import type { CloudAppShareRow } from "./app-share-types";

const SITE = "https://weft.zip";

function share(over: Partial<CloudAppShareRow> = {}): CloudAppShareRow {
  return {
    id: "s1",
    org_id: "o1",
    app_id: "a1",
    name: "Growth",
    kind: "site",
    page: "https://example.com/dash",
    mode: "public",
    owner: "user",
    slug: "growth",
    files: null,
    manifest: null,
    created_by: "u1",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

const PREVIEW = { title: "Growth Dashboard", description: "Retention by cohort", image: "https://x/i.png" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publicPreview", () => {
  it("gives a public link its preview", () => {
    expect(publicPreview(share({ preview: PREVIEW }))).toEqual(PREVIEW);
  });

  it("keeps a private, email or password link's own words away", () => {
    for (const mode of ["private", "email", "password"] as const) {
      expect(publicPreview(share({ mode, preview: PREVIEW }))).toBeNull();
    }
  });

  it("has nothing for a missing share", () => {
    expect(publicPreview(null)).toBeNull();
  });

  it("is empty, not broken, when a public link's preview is unusable", () => {
    expect(publicPreview(share({ preview: "nonsense" }))).toEqual({});
    expect(publicPreview(share({ preview: null }))).toEqual({});
  });
});

describe("cardVersion", () => {
  it("is the same for the same name and preview", () => {
    expect(cardVersion(share({ preview: PREVIEW }))).toBe(cardVersion(share({ preview: PREVIEW })));
  });

  it("changes when the preview changes", () => {
    expect(cardVersion(share({ preview: PREVIEW }))).not.toBe(cardVersion(share({ preview: { ...PREVIEW, title: "Other" } })));
  });

  it("changes when the name changes", () => {
    expect(cardVersion(share({ name: "Growth" }))).not.toBe(cardVersion(share({ name: "Other" })));
  });

  it("is a short base36 string", () => {
    expect(cardVersion(share())).toMatch(/^[0-9a-z]+$/);
  });
});

describe("previewImageUrl", () => {
  it("uses the preview's own https picture as it is", () => {
    expect(previewImageUrl(share(), { image: "https://x/i.png" })).toBe("https://x/i.png");
  });

  it("falls back to the branded card, whose address changes with the preview", () => {
    const url = previewImageUrl(share(), {});
    expect(url.startsWith(`${SITE}/api/a/s1/og?v=`)).toBe(true);
    expect(url).toContain(cardVersion(share()));
  });

  it("falls back for a picture that isn't https", () => {
    expect(previewImageUrl(share(), { image: "http://x/i.png" })).toContain("/og?v=");
  });
});

describe("appShareMetadata", () => {
  it("shows the generic card for a share with no preview, and for no share at all", () => {
    expect(appShareMetadata(null, `${SITE}/a/s1`)).toEqual(GENERIC_APP_METADATA);
    expect(appShareMetadata(share({ mode: "private", preview: PREVIEW }), `${SITE}/a/s1`)).toEqual(GENERIC_APP_METADATA);
    expect(GENERIC_APP_METADATA.title).toBe("Shared app · Weft");
    expect(GENERIC_APP_METADATA.robots).toEqual({ index: false, follow: false });
  });

  it("shows the preview's title, description and picture", () => {
    const meta = appShareMetadata(share({ preview: PREVIEW }), `${SITE}/a/s1`);
    expect(meta.title).toBe("Growth Dashboard · Weft");
    expect(meta.description).toBe("Retention by cohort");
    expect(meta.alternates?.canonical).toBe(`${SITE}/a/s1`);
    expect(meta.openGraph).toMatchObject({ type: "website", siteName: "Weft", title: "Growth Dashboard", description: "Retention by cohort", url: `${SITE}/a/s1` });
    expect(meta.openGraph?.images).toEqual([{ url: "https://x/i.png", width: 1200, height: 630, alt: "Growth Dashboard" }]);
    expect(meta.twitter).toEqual({ card: "summary_large_image", title: "Growth Dashboard", description: "Retention by cohort", images: ["https://x/i.png"] });
  });

  it("keeps the link out of the search engines", () => {
    expect(appShareMetadata(share({ preview: PREVIEW }), `${SITE}/a/s1`).robots).toEqual({ index: false, follow: false });
  });

  it("uses absolute addresses, so it needs no metadataBase", () => {
    const meta = appShareMetadata(share({ preview: PREVIEW }), `${SITE}/a/s1`);
    expect(meta.metadataBase).toBeUndefined();
    expect(meta.alternates?.canonical).toBe(`${SITE}/a/s1`);
  });

  it("falls back to the app's name for the title, and to a plain sentence for the description", () => {
    const meta = appShareMetadata(share({ preview: { description: "D" } }), `${SITE}/a/s1`);
    expect(meta.title).toBe("Growth · Weft");
    expect(meta.description).toBe("D");
    const bare = appShareMetadata(share({ preview: {} }), `${SITE}/a/s1`);
    expect(bare.title).toBe("Growth · Weft");
    expect(bare.description).toBe("Growth, a mini app shared on Weft.");
  });

  it("uses the branded card when the preview has no picture", () => {
    const meta = appShareMetadata(share({ preview: { title: "T" } }), `${SITE}/a/s1`);
    const image = (meta.openGraph?.images as { url: string }[])[0]!.url;
    expect(image.startsWith(`${SITE}/api/a/s1/og?v=`)).toBe(true);
    expect(meta.twitter?.images).toEqual([image]);
  });
});

describe("appMetadataBySlug", () => {
  it("shows the generic card when there is no service client", async () => {
    serviceClientMock.mockReturnValue(null);
    expect(await appMetadataBySlug({ owner: "user", ownerSlug: "alice", slug: "growth" })).toEqual(GENERIC_APP_METADATA);
    expect(loadAppShareBySlugMock).not.toHaveBeenCalled();
  });

  it("shows the share's card under its public address", async () => {
    serviceClientMock.mockReturnValue({} as SupabaseClient);
    loadAppShareBySlugMock.mockResolvedValue(share({ preview: PREVIEW }));
    const meta = await appMetadataBySlug({ owner: "user", ownerSlug: "alice", slug: "growth" });
    expect(meta.title).toBe("Growth Dashboard · Weft");
    expect(meta.alternates?.canonical).toBe(`${SITE}/@alice/apps/growth`);
    expect(loadAppShareBySlugMock).toHaveBeenCalledWith(expect.anything(), { owner: "user", ownerSlug: "alice", slug: "growth" });
  });

  it("shows a workspace app under the workspace's address", async () => {
    serviceClientMock.mockReturnValue({} as SupabaseClient);
    loadAppShareBySlugMock.mockResolvedValue(share({ owner: "org", preview: PREVIEW }));
    const meta = await appMetadataBySlug({ owner: "org", ownerSlug: "aimhuge", slug: "growth" });
    expect(meta.alternates?.canonical).toBe(`${SITE}/aimhuge/apps/growth`);
  });

  it("shows the generic card for a share that isn't there", async () => {
    serviceClientMock.mockReturnValue({} as SupabaseClient);
    loadAppShareBySlugMock.mockResolvedValue(null);
    expect(await appMetadataBySlug({ owner: "user", ownerSlug: "alice", slug: "growth" })).toEqual(GENERIC_APP_METADATA);
  });
});

describe("appMetadataById", () => {
  it("shows the generic card when there is no service client", async () => {
    serviceClientMock.mockReturnValue(null);
    expect(await appMetadataById("s1")).toEqual(GENERIC_APP_METADATA);
    expect(loadAppShareMock).not.toHaveBeenCalled();
  });

  it("shows the share's card under its /a/<id> address", async () => {
    serviceClientMock.mockReturnValue({} as SupabaseClient);
    loadAppShareMock.mockResolvedValue(share({ preview: PREVIEW }));
    const meta = await appMetadataById("s1");
    expect(meta.title).toBe("Growth Dashboard · Weft");
    expect(meta.alternates?.canonical).toBe(`${SITE}/a/s1`);
    expect(loadAppShareMock).toHaveBeenCalledWith(expect.anything(), "s1");
  });

  it("shows the generic card for a share that isn't there", async () => {
    serviceClientMock.mockReturnValue({} as SupabaseClient);
    loadAppShareMock.mockResolvedValue(null);
    expect(await appMetadataById("s1")).toEqual(GENERIC_APP_METADATA);
  });
});

describe("shareByline", () => {
  function serviceWith(table: string, row: unknown) {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(() => Promise.resolve({ data: row, error: null }));
    return { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  }

  it("names the sharer by their username", async () => {
    expect(await shareByline(serviceWith("profiles", { username: "alice" }), share({ owner: "user" }))).toBe("@alice");
  });

  it("names the workspace by its name", async () => {
    expect(await shareByline(serviceWith("orgs", { name: "Acme", slug: "acme" }), share({ owner: "org" }))).toBe("Acme");
  });

  it("falls back to the workspace's slug", async () => {
    expect(await shareByline(serviceWith("orgs", { name: null, slug: "acme" }), share({ owner: "org" }))).toBe("acme");
  });

  it("falls back to weft.zip when there's nothing to name", async () => {
    expect(await shareByline(serviceWith("orgs", null), share({ owner: "org" }))).toBe("weft.zip");
  });

  it("falls back to the workspace for a user link whose profile has no username", async () => {
    expect(await shareByline(serviceWith("profiles", null), share({ owner: "user" }))).toBe("weft.zip");
  });
});

describe("blobBytes", () => {
  it("reads the blob from the workspace's folder", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const download = vi.fn(() => Promise.resolve({ data: { arrayBuffer: () => Promise.resolve(bytes) } }));
    const service = { storage: { from: vi.fn(() => ({ download })) } } as unknown as SupabaseClient;
    const out = await blobBytes(service, "o1", "abc");
    expect(out).toBe(bytes);
    expect(download).toHaveBeenCalledWith("o1/abc");
  });

  it("has nothing when the blob is missing", async () => {
    const service = { storage: { from: vi.fn(() => ({ download: vi.fn(() => Promise.resolve({ data: null })) })) } } as unknown as SupabaseClient;
    expect(await blobBytes(service, "o1", "abc")).toBeNull();
  });
});
