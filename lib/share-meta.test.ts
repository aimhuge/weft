// lib/share-meta.ts: what a shared thread's link unfurls as. Only a public link shows the card's title,
// its first ask and its pane capture; a private, email or password link keeps the generic card, so
// nothing of the thread reaches a stranger's chat.
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { serviceClient: serviceClientMock, loadShare: loadShareMock, shareIdBySlug: shareIdBySlugMock } = vi.hoisted(() => ({
  serviceClient: vi.fn(),
  loadShare: vi.fn(),
  shareIdBySlug: vi.fn(),
}));

vi.mock("@/lib/web-session", () => ({ serviceClient: serviceClientMock }));
vi.mock("./web-session", () => ({ serviceClient: serviceClientMock }));
vi.mock("./share-access", () => ({ loadShare: loadShareMock, shareIdBySlug: shareIdBySlugMock }));

import {
  firstAsk,
  GENERIC_THREAD_METADATA,
  threadCardVersion,
  threadMetadataById,
  threadMetadataBySlug,
  threadPreview,
  threadShareMetadata,
} from "./share-meta";
import type { LoadedShare } from "./share-access";
import type { CloudShareRow } from "./share-types";

const SITE = "https://weft.zip";
const SHA = "a".repeat(64);
const REF = `blob:sha256:${SHA}`;
// Built at run time so no key-shaped literal sits in the file for the pre-commit secret scan.
const STRIPE_KEY = ["sk", "live", "51HxK9e2eZvKYlo2CcZ3pD6Xr"].join("_");

function share(over: Partial<CloudShareRow> = {}): CloudShareRow {
  return {
    id: "sh1",
    org_id: "org-1",
    card_id: "c1",
    mode: "public",
    password_hash: null,
    slug: "fix-the-login-bug",
    show_chat: true,
    created_by: "u1",
    created_at: "2026-10-20T00:00:00.000Z",
    updated_at: "2026-10-20T00:00:00.000Z",
    ...over,
  };
}

function loaded(over: Partial<LoadedShare> = {}): LoadedShare {
  return {
    share: share(),
    card: { card_id: "c1", card: { id: "c1", title: "Fix the login bug", emoji: "🐛" }, deleted: false, updated_at: "2026-10-20T00:00:00.000Z" },
    ...over,
  };
}

// A service client whose cloud_thread_items query answers with `rows`. The chain is awaited, so it
// has to be thenable like Supabase's own builder.
function serviceWithItems(rows: unknown[] | null, error: unknown = null) {
  const make = (): Record<string, unknown> & { then?: unknown } => {
    const obj: Record<string, unknown> & { then?: unknown } = {
      then: (onFulfilled: (v: { data: unknown[] | null; error: unknown }) => unknown) =>
        Promise.resolve({ data: rows, error }).then(onFulfilled),
    };
    for (const k of ["select", "eq", "order", "limit", "overrideTypes"]) obj[k] = vi.fn(() => make());
    return obj;
  };
  return { from: vi.fn(() => make()) } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("firstAsk", () => {
  it("is the first thing the user asked, cut to a line", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "Fix the login bug please", at: 1 } }]);
    expect(await firstAsk(svc, share())).toBe("Fix the login bug please");
  });

  it("redacts a secret out of the ask before it shows", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: `here is ${STRIPE_KEY}`, at: 1 } }]);
    const out = await firstAsk(svc, share());
    expect(out).not.toContain(STRIPE_KEY);
    expect(out).toContain("‹hidden:");
  });

  it("skips the items that came before the user's first one", async () => {
    const svc = serviceWithItems([
      { item: { kind: "tool", id: "t1", name: "read", summary: "s", at: 1 } },
      { item: { kind: "user", text: "the real ask", at: 2 } },
    ]);
    expect(await firstAsk(svc, share())).toBe("the real ask");
  });

  it("is nothing when the chat is hidden", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "hidden ask", at: 1 } }]);
    expect(await firstAsk(svc, share({ show_chat: false }))).toBeUndefined();
  });

  it("is nothing when the thread has no user item", async () => {
    const svc = serviceWithItems([{ item: { kind: "tool", id: "t1", name: "read", summary: "s", at: 1 } }]);
    expect(await firstAsk(svc, share())).toBeUndefined();
  });

  it("is nothing when the thread is empty", async () => {
    const svc = serviceWithItems([]);
    expect(await firstAsk(svc, share())).toBeUndefined();
  });

  it("is nothing when the query answers with no rows at all", async () => {
    const svc = serviceWithItems(null);
    expect(await firstAsk(svc, share())).toBeUndefined();
  });
});

describe("threadPreview", () => {
  it("is the card's title and the thread's first ask", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "Fix the login bug please", at: 1 } }]);
    const preview = await threadPreview(svc, loaded());
    expect(preview).toMatchObject({
      title: "Fix the login bug",
      description: "Fix the login bug please",
    });
  });

  it("has nothing for a share that isn't there", async () => {
    expect(await threadPreview(serviceWithItems([]), null)).toBeNull();
  });

  it("has nothing for a share whose card is gone", async () => {
    expect(await threadPreview(serviceWithItems([]), loaded({ card: null }))).toBeNull();
  });

  it("has nothing for a link that isn't public", async () => {
    for (const mode of ["private", "email", "password"] as const) {
      expect(await threadPreview(serviceWithItems([]), loaded({ share: share({ mode }) }))).toBeNull();
    }
  });

  it("puts the card's emoji in front of its name", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "ask", at: 1 } }]);
    const preview = await threadPreview(svc, loaded());
    expect(preview?.name).toBe("🐛 Fix the login bug");
    // The title itself stays bare.
    expect(preview?.title).toBe("Fix the login bug");
  });

  it("has no emoji in the name when the card has none", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "ask", at: 1 } }]);
    const preview = await threadPreview(svc, loaded({ card: { card_id: "c1", card: { id: "c1", title: "Plain" }, deleted: false, updated_at: "2026-10-20T00:00:00.000Z" } }));
    expect(preview?.name).toBe("Plain");
  });

  it("falls back to a plain sentence when the chat is hidden", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "hidden ask", at: 1 } }]);
    const preview = await threadPreview(svc, loaded({ share: share({ show_chat: false }) }));
    expect(preview?.description).toBe("A thread built with Weft: the chat and the page it made, live.");
    expect(preview?.description).not.toContain("hidden ask");
  });

  it("falls back to a plain sentence when the thread has no user item", async () => {
    const svc = serviceWithItems([]);
    const preview = await threadPreview(svc, loaded());
    expect(preview?.description).toBe("A thread built with Weft: the chat and the page it made, live.");
  });

  it("has the card's pane capture when it is a blob ref", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "ask", at: 1 } }]);
    const preview = await threadPreview(svc, loaded({ card: { card_id: "c1", card: { id: "c1", title: "T", thumb: REF }, deleted: false, updated_at: "2026-10-20T00:00:00.000Z" } }));
    expect(preview?.thumb).toBe(REF);
  });

  it("has no capture when the thumb is a path on the owner's Mac", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "ask", at: 1 } }]);
    const preview = await threadPreview(svc, loaded({ card: { card_id: "c1", card: { id: "c1", title: "T", thumb: "/api/attachments/pane.jpg" }, deleted: false, updated_at: "2026-10-20T00:00:00.000Z" } }));
    expect(preview?.thumb).toBeUndefined();
  });

  it("is a plain title when the card has none", async () => {
    const svc = serviceWithItems([{ item: { kind: "user", text: "ask", at: 1 } }]);
    const preview = await threadPreview(svc, loaded({ card: { card_id: "c1", card: { id: "c1", title: "" }, deleted: false, updated_at: "2026-10-20T00:00:00.000Z" } }));
    expect(preview?.title).toBe("Shared thread");
    expect(preview?.name).toBe("Shared thread");
  });
});

describe("threadCardVersion", () => {
  it("is the same for the same preview", () => {
    const preview = { name: "🐛 T", title: "T", description: "D" };
    expect(threadCardVersion(preview)).toBe(threadCardVersion({ ...preview }));
  });

  it("changes when the preview changes", () => {
    const preview = { name: "🐛 T", title: "T", description: "D" };
    expect(threadCardVersion(preview)).not.toBe(threadCardVersion({ ...preview, title: "Other" }));
    expect(threadCardVersion(preview)).not.toBe(threadCardVersion({ ...preview, description: "Other" }));
  });

  it("is a short base36 string", () => {
    expect(threadCardVersion({ name: "🐛 T", title: "T", description: "D" })).toMatch(/^[0-9a-z]+$/);
  });
});

describe("threadShareMetadata", () => {
  const preview = { name: "🐛 Fix the login bug", title: "Fix the login bug", description: "Fix it please" };

  it("shows the generic card when there is no preview", () => {
    expect(threadShareMetadata("sh1", null, `${SITE}/s/sh1`)).toEqual(GENERIC_THREAD_METADATA);
    expect(GENERIC_THREAD_METADATA.title).toBe("Shared thread · Weft");
    expect(GENERIC_THREAD_METADATA.robots).toEqual({ index: false, follow: false });
  });

  it("shows the preview's title and description", () => {
    const meta = threadShareMetadata("sh1", preview, `${SITE}/s/sh1`);
    expect(meta.title).toBe("Fix the login bug · Weft");
    expect(meta.description).toBe("Fix it please");
    expect(meta.alternates?.canonical).toBe(`${SITE}/s/sh1`);
    expect(meta.openGraph).toMatchObject({ type: "article", siteName: "Weft", title: "Fix the login bug", description: "Fix it please", url: `${SITE}/s/sh1` });
  });

  it("points at the card's own picture, whose address changes with the preview", () => {
    const meta = threadShareMetadata("sh1", preview, `${SITE}/s/sh1`);
    const image = (meta.openGraph?.images as { url: string }[])[0]!;
    expect(image.url.startsWith(`${SITE}/api/s/sh1/og?v=`)).toBe(true);
    expect(image.url).toContain(threadCardVersion(preview));
    expect(image).toMatchObject({ width: 1200, height: 630, alt: "Fix the login bug" });
    expect(meta.twitter).toEqual({ card: "summary_large_image", title: "Fix the login bug", description: "Fix it please", images: [image.url] });
  });

  it("keeps the link out of the search engines", () => {
    expect(threadShareMetadata("sh1", preview, `${SITE}/s/sh1`).robots).toEqual({ index: false, follow: false });
  });

  it("uses absolute addresses, so it needs no metadataBase", () => {
    const meta = threadShareMetadata("sh1", preview, `${SITE}/s/sh1`);
    expect(meta.metadataBase).toBeUndefined();
  });
});

describe("threadMetadataById", () => {
  it("shows the generic card when there is no service client", async () => {
    serviceClientMock.mockReturnValue(null);
    expect(await threadMetadataById("sh1")).toEqual(GENERIC_THREAD_METADATA);
    expect(loadShareMock).not.toHaveBeenCalled();
  });

  it("shows the share's card under its /s/<id> address", async () => {
    serviceClientMock.mockReturnValue(serviceWithItems([]));
    loadShareMock.mockResolvedValue(loaded());
    const meta = await threadMetadataById("sh1");
    expect(meta.title).toBe("Fix the login bug · Weft");
    expect(meta.alternates?.canonical).toBe(`${SITE}/s/sh1`);
    expect(loadShareMock).toHaveBeenCalledWith("sh1");
  });

  it("shows the generic card for a share that isn't there", async () => {
    serviceClientMock.mockReturnValue(serviceWithItems([]));
    loadShareMock.mockResolvedValue(null);
    expect(await threadMetadataById("sh1")).toEqual(GENERIC_THREAD_METADATA);
  });

  it("shows the generic card for a link that isn't public", async () => {
    serviceClientMock.mockReturnValue(serviceWithItems([]));
    loadShareMock.mockResolvedValue(loaded({ share: share({ mode: "private" }) }));
    expect(await threadMetadataById("sh1")).toEqual(GENERIC_THREAD_METADATA);
  });
});

describe("threadMetadataBySlug", () => {
  it("shows the generic card when there is no service client", async () => {
    serviceClientMock.mockReturnValue(null);
    expect(await threadMetadataBySlug("alice", "fix-the-login-bug")).toEqual(GENERIC_THREAD_METADATA);
    expect(shareIdBySlugMock).not.toHaveBeenCalled();
  });

  it("shows the share's card under its public address", async () => {
    serviceClientMock.mockReturnValue(serviceWithItems([]));
    shareIdBySlugMock.mockResolvedValue("sh1");
    loadShareMock.mockResolvedValue(loaded());
    const meta = await threadMetadataBySlug("alice", "fix-the-login-bug");
    expect(meta.title).toBe("Fix the login bug · Weft");
    expect(meta.alternates?.canonical).toBe(`${SITE}/@alice/threads/fix-the-login-bug`);
    expect(shareIdBySlugMock).toHaveBeenCalledWith(expect.anything(), "alice", "fix-the-login-bug");
    expect(loadShareMock).toHaveBeenCalledWith("sh1");
  });

  it("shows the generic card for a slug that isn't there", async () => {
    serviceClientMock.mockReturnValue(serviceWithItems([]));
    shareIdBySlugMock.mockResolvedValue(null);
    expect(await threadMetadataBySlug("alice", "fix-the-login-bug")).toEqual(GENERIC_THREAD_METADATA);
    expect(loadShareMock).not.toHaveBeenCalled();
  });
});
