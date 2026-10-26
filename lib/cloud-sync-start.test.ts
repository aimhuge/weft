import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "./cloud-sync-types";
import type { ThreadItem } from "./types";

const accountClient = vi.fn(() => ({ fake: "client" }));
const bundle = {
  refFor: vi.fn(() => Promise.resolve(null)),
  upload: vi.fn(() => Promise.resolve(null)),
  rewriteItem: vi.fn((item: ThreadItem) => Promise.resolve(item)),
  fetchBlob: vi.fn(),
};
const createBlobStore = vi.fn(() => bundle);
const stop = vi.fn();
const stopInbox = vi.fn();
const startCloudInbox = vi.fn(() => stopInbox);
let passed: BlobStore | undefined;

vi.mock("./account", () => ({ accountClient: () => accountClient() }));
vi.mock("./blob-store", () => ({ createBlobStore: (opts: unknown) => (createBlobStore as (o: unknown) => typeof bundle)(opts) }));
vi.mock("./cloud-sync", () => ({
  startCloudSync: (opts: { blobs: BlobStore }) => {
    passed = opts.blobs;
    return stop;
  },
}));

vi.mock("./cloud-inbox", () => ({ startCloudInbox: () => startCloudInbox() }));
const stopRepos = vi.fn();
const startSyncRepos = vi.fn(() => stopRepos);
vi.mock("./cloud-sync-repos", () => ({ startSyncRepos: () => startSyncRepos() }));

const { startAccountCloudSync } = await import("./cloud-sync-start");

beforeEach(() => {
  vi.clearAllMocks();
  passed = undefined;
});

describe("startAccountCloudSync", () => {
  it("starts the outbox and the inbox, and the stop it returns ends both", () => {
    const end = startAccountCloudSync();
    expect(passed).toBeDefined();
    expect(startCloudInbox).toHaveBeenCalledTimes(1);
    expect(startSyncRepos).toHaveBeenCalledTimes(1);
    end();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stopInbox).toHaveBeenCalledTimes(1);
    expect(stopRepos).toHaveBeenCalledTimes(1);
  });

  it("makes no client or blob store until a flush needs one", () => {
    startAccountCloudSync();
    expect(accountClient).not.toHaveBeenCalled();
    expect(createBlobStore).not.toHaveBeenCalled();
  });

  it("makes the blob store once, on the account's client, and passes each call through", async () => {
    startAccountCloudSync();
    const item: ThreadItem = { kind: "user", text: "hi", at: 1 };
    await passed!.refFor("/a.png");
    await passed!.upload("/a.png", "org");
    expect(await passed!.rewriteItem(item, "org")).toBe(item);
    expect(createBlobStore).toHaveBeenCalledTimes(1);
    expect(createBlobStore).toHaveBeenCalledWith({ client: { fake: "client" } });
    expect(bundle.refFor).toHaveBeenCalledWith("/a.png");
    expect(bundle.upload).toHaveBeenCalledWith("/a.png", "org");
    expect(bundle.rewriteItem).toHaveBeenCalledWith(item, "org");
  });
});
