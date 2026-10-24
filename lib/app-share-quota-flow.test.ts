// lib/app-share.ts with the plan's room for shared apps (lib/app-share-quota.ts): a write that wouldn't fit is
// refused before anything uploads, the database trigger's refusal reads as the dialog's wording, and a re-upload on
// open that wouldn't fit leaves the link on its last version with the reason in the state.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  writeError: null as { message: string } | null,
  over: null as string | null,
  uploads: 0,
  states: [] as unknown[],
}));

const client = {
  auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: "u1" } } } }) },
  from: () => {
    const done = () => Promise.resolve({ error: h.writeError });
    return { update: () => ({ eq: done }), insert: done, delete: () => ({ eq: () => ({ eq: done }) }) };
  },
};

vi.mock("./account", () => ({ accountClient: () => client }));
vi.mock("./cloud-sync", () => ({ syncOrgId: () => Promise.resolve("o1") }));
vi.mock("./mini-app-store", () => ({ listApps: () => [{ id: "a1", name: "My App", url: "https://example.com/page" }] }));
vi.mock("./app-preview-capture", () => ({ refreshAppPreview: vi.fn(async () => {}) }));
vi.mock("./app-share-owners", () => ({ listOwners: () => Promise.resolve({ user: null, orgs: [] }) }));
vi.mock("@aimhuge/share/server", () => ({ hashSharePassword: (p: string) => `hash(${p})` }));
vi.mock("./app-share-row", () => ({
  readShare: () => Promise.resolve(h.row),
  currentPage: (_t: unknown, upload: boolean) => {
    if (upload) h.uploads++;
    return Promise.resolve({ kind: "site", page: "https://example.com/new", files: null, manifest: null });
  },
  pageForWrite: () => {
    h.uploads++;
    return Promise.resolve({ kind: "site", page: "https://example.com/page", files: null, manifest: null });
  },
  sameFiles: () => true,
  sameManifest: () => true,
  stateOf: (_t: unknown, row: unknown, over?: string) => {
    const s = { kind: "ok", row, over };
    h.states.push(s);
    return Promise.resolve(s);
  },
}));
vi.mock("./app-share-quota", async (real) => ({
  ...(await real<typeof import("./app-share-quota")>()),
  roomFor: () => Promise.resolve(h.over),
}));

const { getAppShare, setAppShare } = await import("./app-share");

const ROW = { id: "abcdefghijklmnopqrstuv", mode: "public", name: "My App", kind: "site", page: "https://example.com/page", owner: "user", slug: null, files: null, manifest: null, org_id: "o1" };

beforeEach(() => {
  Object.assign(h, { row: { ...ROW }, writeError: null, over: null, uploads: 0, states: [] });
});

describe("setAppShare and the plan's room", () => {
  it("refuses a link that wouldn't fit, before uploading, with a 402", async () => {
    h.over = "This app is 31 MB.";
    await expect(setAppShare("a1", { mode: "public" })).rejects.toMatchObject({ status: 402, message: "This app is 31 MB." });
    expect(h.uploads).toBe(0);
  });

  it("turns the trigger's refusal into the dialog's wording", async () => {
    h.writeError = { message: "app_share_quota: 31457280 of 26214400 bytes on the free plan" };
    const err = await setAppShare("a1", { mode: "public" }).catch((e: unknown) => e as { status: number; message: string });
    expect(err).toMatchObject({ status: 402 });
    expect((err as { message: string }).message).toMatch(/Free plan's shared apps have 25 MB/);
  });

  it("still throws any other write error", async () => {
    h.writeError = { message: "boom" };
    await expect(setAppShare("a1", { mode: "public" })).rejects.toMatchObject({ status: 500 });
  });
});

describe("getAppShare and the plan's room", () => {
  it("keeps the last version when the latest edits wouldn't fit", async () => {
    h.over = "Too big.";
    expect(await getAppShare("a1")).toMatchObject({ over: "Too big." });
    expect(h.uploads).toBe(0);
  });

  it("reads the trigger's refusal on a re-upload as the reason", async () => {
    h.writeError = { message: "app_share_quota: 30000000 of 26214400 bytes on the free plan" };
    const state = (await getAppShare("a1")) as unknown as { over: string };
    expect(state.over).toMatch(/Make another app's link private/);
  });

  it("throws any other re-upload error", async () => {
    h.writeError = { message: "boom" };
    await expect(getAppShare("a1")).rejects.toMatchObject({ status: 500 });
  });
});
