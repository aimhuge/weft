// lib/blob-seal.ts: a blob sealed for its org and sha opens there only, to bytes that are the ref's; a plain blob (from
// before sealing, or one that only looks sealed) passes through; a store view seals every upload it makes.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { blobSealer, openBlob, sealedVersion, sha256Hex, withBlobSeal } from "./blob-seal";
import type { BlobStore } from "./cloud-sync-types";
import type { ThreadItem } from "./types";
import { b64, sodium, type Sodium } from "./sodium";
import type { SyncKey } from "./sync-seal";

let s: Sodium;
let key: SyncKey;
let ring: Map<number, string>;
beforeAll(async () => {
  s = await sodium();
  key = { version: 4, key: b64(s, s.crypto_aead_xchacha20poly1305_ietf_keygen()) };
  ring = new Map([[4, key.key]]);
});

const ORG = "org-1";
const PLAIN = new TextEncoder().encode("<html>a page</html>");
const SHA = createHash("sha256").update(PLAIN).digest("hex");

describe("sha256Hex", () => {
  it("is node's sha256, in hex", async () => {
    expect(await sha256Hex(PLAIN)).toBe(SHA);
  });
});

describe("sealing and opening", () => {
  it("round-trips, and the stored bytes say nothing of the page", async () => {
    const sealed = blobSealer(s, key)(ORG, SHA, PLAIN);
    expect(new TextDecoder().decode(sealed)).not.toContain("a page");
    expect(sealedVersion(sealed)).toBe(4);
    expect(await openBlob(s, sealed, ring, ORG, SHA)).toEqual({ bytes: PLAIN, sealed: true });
  });

  it("won't open in another org, under another sha, or without the key's version", async () => {
    const sealed = blobSealer(s, key)(ORG, SHA, PLAIN);
    expect(await openBlob(s, sealed, ring, "org-2", SHA)).toBeNull();
    expect(await openBlob(s, sealed, ring, ORG, "0".repeat(64))).toBeNull();
    expect(await openBlob(s, sealed, new Map(), ORG, SHA)).toBeNull();
  });

  it("refuses bytes that open but aren't the ref's (a key holder swapping content)", async () => {
    const other = new TextEncoder().encode("something else");
    const sealed = blobSealer(s, key)(ORG, SHA, other);
    expect(await openBlob(s, sealed, ring, ORG, SHA)).toBeNull();
  });

  it("passes a plain blob through, even one that starts with the magic", async () => {
    expect(await openBlob(s, PLAIN, ring, ORG, SHA)).toEqual({ bytes: PLAIN, sealed: false });
    expect(sealedVersion(PLAIN)).toBeNull();
    const lookalike = new Uint8Array([0x77, 0x73, 0x62, 0x31, 0, 0, 0, 9, 1, 2, 3]);
    const its = createHash("sha256").update(lookalike).digest("hex");
    expect(await openBlob(s, lookalike, ring, ORG, its)).toEqual({ bytes: lookalike, sealed: false });
  });
});

describe("withBlobSeal", () => {
  const store = () => {
    const fns = {
      refFor: vi.fn<BlobStore["refFor"]>(() => Promise.resolve(null)),
      upload: vi.fn<BlobStore["upload"]>(() => Promise.resolve(null)),
      uploadPage: vi.fn<NonNullable<BlobStore["uploadPage"]>>(() => Promise.resolve(null)),
      rewriteItem: vi.fn<BlobStore["rewriteItem"]>((item: ThreadItem) => Promise.resolve(item)),
    };
    return { fns, blobs: { ...fns } as BlobStore };
  };

  it("is the store itself without a seal", () => {
    const { blobs } = store();
    expect(withBlobSeal(blobs, null)).toBe(blobs);
  });

  it("passes the seal to every upload", async () => {
    const { fns, blobs } = store();
    const seal = blobSealer(s, key);
    const view = withBlobSeal(blobs, seal);
    const item = { kind: "user" as const, text: "x", at: 1 };
    await view.refFor("/a");
    await view.upload("/a", ORG);
    await view.uploadPage?.("/p", ORG);
    await view.rewriteItem(item, ORG);
    expect(fns.refFor).toHaveBeenCalledWith("/a");
    expect(fns.upload).toHaveBeenCalledWith("/a", ORG, seal);
    expect(fns.uploadPage).toHaveBeenCalledWith("/p", ORG, seal);
    expect(fns.rewriteItem).toHaveBeenCalledWith(item, ORG, seal);
  });

  it("leaves uploadPage out for a store without one", () => {
    const { fns } = store();
    const bare: BlobStore = { refFor: fns.refFor, upload: fns.upload, rewriteItem: fns.rewriteItem };
    expect("uploadPage" in withBlobSeal(bare, blobSealer(s, key))).toBe(false);
  });
});
