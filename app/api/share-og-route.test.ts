// app/api/s/[id]/og/route.ts: the picture a public thread link unfurls as. Only a public link gets
// the card; a gated one is a 404, so a hidden thread's capture never leaves weft.zip. The share's
// own lib and the card's picture are mocked — this route only decides what a link shows.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface State {
  service: unknown;
  share: unknown;
  preview: unknown;
  bytes: ArrayBuffer | null;
  cardImageCalls: { input: unknown; opts: unknown }[];
  blobBytesCalls: { orgId: string; sha: string }[];
}

const state: State = vi.hoisted(() => ({
  service: null,
  share: null,
  preview: null,
  bytes: null,
  cardImageCalls: [],
  blobBytesCalls: [],
}));

vi.mock("@/lib/web-session", () => ({
  serviceClient: () => state.service,
}));

vi.mock("@/lib/share-access", () => ({
  loadShare: vi.fn(() => Promise.resolve(state.share)),
}));

vi.mock("@/lib/share-meta", () => ({
  threadPreview: vi.fn(() => Promise.resolve(state.preview)),
}));

vi.mock("@/lib/app-share-meta", () => ({
  blobBytes: vi.fn((_service: unknown, orgId: string, sha: string) => {
    state.blobBytesCalls.push({ orgId, sha });
    return Promise.resolve(state.bytes);
  }),
}));

vi.mock("@/lib/app-card-image", () => ({
  appCardImage: vi.fn((input: unknown, opts: unknown) => {
    state.cardImageCalls.push({ input, opts });
    return Promise.resolve(new Response("card-image", { headers: { "Content-Type": "image/png" } }));
  }),
}));

const ogRoute = await import("./s/[id]/og/route");

const SHA = "a".repeat(64);
const REF = `blob:sha256:${SHA}`;

// The asymmetric matchers come back as `any`; these wrappers keep them typed, so an assertion
// built from one is an ordinary object again.
const objectContaining = (sample: Record<string, unknown>) =>
  expect.objectContaining(sample) as unknown as Record<string, unknown>;
const stringContaining = (sample: string) => expect.stringContaining(sample) as unknown as string;

const og = (id = "abcdefghijklmnop") =>
  ogRoute.GET(new Request(`http://localhost:3457/api/s/${id}/og`), { params: Promise.resolve({ id }) });

// A service client whose profiles row has no username.
const bareService = () => ({
  from: () => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return builder;
  },
});

beforeEach(() => {
  state.service = bareService();
  state.share = { share: { id: "sh1", org_id: "org-1", card_id: "c1", mode: "public", created_by: "u1" }, card: { card_id: "c1", card: { id: "c1", title: "T" }, deleted: false, updated_at: "2026-10-20T00:00:00.000Z" } };
  state.preview = { name: "🐛 T", title: "T", description: "D" };
  state.bytes = null;
  state.cardImageCalls = [];
  state.blobBytesCalls = [];
});

describe("GET /api/s/[id]/og", () => {
  it("says so when sharing isn't set up on this server", async () => {
    state.service = null;
    const res = await og();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("Sharing isn't set up on this server.");
  });

  it("is a 404 for a share that isn't there", async () => {
    state.share = null;
    const res = await og();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("is a 404 for a link that isn't public", async () => {
    state.preview = null;
    const res = await og();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
    expect(state.cardImageCalls).toEqual([]);
  });

  it("draws the branded card for a public link", async () => {
    const res = await og();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("card-image");
    expect(state.cardImageCalls[0]?.input).toMatchObject({ name: "🐛 T", title: "T", description: "D" });
    expect(state.cardImageCalls[0]?.opts).toMatchObject({ headers: objectContaining({ "Cache-Control": stringContaining("max-age") }) });
  });

  it("names the sharer by their username", async () => {
    const svc = {
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.maybeSingle = vi.fn(() => Promise.resolve({ data: table === "profiles" ? { username: "alice" } : null, error: null }));
        return builder;
      },
    };
    state.service = svc;
    await og();
    expect(state.cardImageCalls[0]?.input).toMatchObject({ byline: "@alice" });
  });

  it("falls back to weft.zip when the sharer has no username", async () => {
    const svc = {
      from: () => {
        const builder: Record<string, unknown> = {};
        builder.select = vi.fn(() => builder);
        builder.eq = vi.fn(() => builder);
        builder.maybeSingle = vi.fn(() => Promise.resolve({ data: { username: null }, error: null }));
        return builder;
      },
    };
    state.service = svc;
    await og();
    expect(state.cardImageCalls[0]?.input).toMatchObject({ byline: "weft.zip" });
  });

  it("falls back to weft.zip when the share has no sharer", async () => {
    state.share = { share: { id: "sh1", org_id: "org-1", card_id: "c1", mode: "public" }, card: { card_id: "c1", card: { id: "c1", title: "T" }, deleted: false, updated_at: "2026-10-20T00:00:00.000Z" } };
    await og();
    expect(state.cardImageCalls[0]?.input).toMatchObject({ byline: "weft.zip" });
    // With no sharer there's no profile to read, so the client is never asked.
    expect(state.blobBytesCalls).toEqual([]);
  });

  it("puts the card's pane capture in the card, from the workspace's blob", async () => {
    state.preview = { name: "🐛 T", title: "T", description: "D", thumb: REF };
    await og();
    // The blob's ref is stripped down to its sha, and read from the share's own workspace.
    expect(state.blobBytesCalls).toEqual([{ orgId: "org-1", sha: SHA }]);
    expect(state.cardImageCalls[0]?.input).toMatchObject({ shot: null });
  });

  it("has no capture to read when the link has no thumb", async () => {
    await og();
    expect(state.blobBytesCalls).toEqual([]);
    expect(state.cardImageCalls[0]?.input).toMatchObject({ shot: null });
  });
});
