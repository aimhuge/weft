import { describe, expect, it, vi } from "vitest";
import { presignGet, r2Config, r2Get, r2Key, r2Put, signedHeaders, type R2Config } from "./r2";

const CFG: R2Config = { accountId: "0123456789abcdef0123456789abcdef", accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", bucket: "weft-blobs" };
const ORG = "11111111-2222-3333-4444-555555555555";
const SHA = "a".repeat(64);
const KEY = r2Key(ORG, SHA);
const HOST = `${CFG.accountId}.r2.cloudflarestorage.com`;
const AT = Date.UTC(2026, 9, 29, 16, 0, 0);
// The signatures the aws4 package (the reference SigV4 signer) makes for the same requests at AT, worked out once.
const AWS4_GET = "40f64e4eca8058cc037abaf968de2e93f4d5f691110dce129a68640f61e58d01";
const AWS4_PUT = "3e1fc193b18b795efb1fa51a1ccc1f0b045afc967c2219f44391072bdf778192";

describe("r2Config", () => {
  it("reads the three keys and defaults the bucket", () => {
    expect(r2Config({ R2_ACCOUNT_ID: " a ", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c" })).toEqual({ accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "weft-blobs" });
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "other" })?.bucket).toBe("other");
  });

  it("is null when a key is missing or R2 is switched off", () => {
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b" })).toBeNull();
    expect(r2Config({})).toBeNull();
    expect(r2Config({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", WEFT_BLOBS_R2: "off" })).toBeNull();
  });
});

describe("presignGet", () => {
  it("matches the aws4 reference signer", () => {
    const url = new URL(presignGet(CFG, KEY, AT));
    expect(url.host).toBe(HOST);
    expect(url.pathname).toBe(`/weft-blobs/${KEY}`);
    expect(url.searchParams.get("X-Amz-Signature")).toBe(AWS4_GET);
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AKIDEXAMPLE/20261029/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("7200");
  });

  it("signs at the top of the hour, so a blob's URL holds still for an hour", () => {
    const a = presignGet(CFG, KEY, AT + 60_000);
    const b = presignGet(CFG, KEY, AT + 59 * 60_000);
    const c = presignGet(CFG, KEY, AT + 61 * 60_000);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(new URL(a).searchParams.get("X-Amz-Date")).toBe("20261029T160000Z");
  });
});

describe("signedHeaders", () => {
  it("matches the aws4 reference signer for a PUT", () => {
    const ours = signedHeaders(CFG, "PUT", KEY, { "Content-Type": "image/png", "cache-control": " private, max-age=31536000, immutable " }, AT);
    expect(ours["x-amz-date"]).toBe("20261029T160000Z");
    expect(ours.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261029/auto/s3/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=${AWS4_PUT}`,
    );
    expect(ours).not.toHaveProperty("host");
  });
});

describe("r2Put / r2Get", () => {
  it("PUTs the bytes with the type and an immutable cache header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    await r2Put(CFG, KEY, new Uint8Array([1, 2]), "image/png", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe(`https://${HOST}/weft-blobs/${KEY}`);
    expect(init.method).toBe("PUT");
    expect(init.headers["content-type"]).toBe("image/png");
    expect(init.headers["cache-control"]).toContain("immutable");
  });

  it("throws when the PUT fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("no", { status: 403 }));
    await expect(r2Put(CFG, KEY, new Uint8Array([1]), "image/png", fetchImpl)).rejects.toThrow("403");
  });

  it("GETs bytes and type, or null on a miss or a network error", async () => {
    const hit = vi.fn().mockResolvedValue(new Response(new Uint8Array([7]), { status: 200, headers: { "content-type": "text/html" } }));
    const got = await r2Get(CFG, KEY, hit);
    expect(got?.type).toBe("text/html");
    expect(new Uint8Array(got?.bytes ?? new ArrayBuffer(0))).toEqual(new Uint8Array([7]));
    expect(await r2Get(CFG, KEY, vi.fn().mockResolvedValue(new Response(null, { status: 404 })))).toBeNull();
    expect(await r2Get(CFG, KEY, vi.fn().mockRejectedValue(new Error("down")))).toBeNull();
  });

  it("answers an empty type when R2 sends none", async () => {
    const res = new Response(new Uint8Array([1]), { status: 200 });
    res.headers.delete("content-type");
    expect((await r2Get(CFG, KEY, vi.fn().mockResolvedValue(res)))?.type).toBe("");
  });
});
