import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { mirroredShas, resolveBlobUrls } from "./blob-urls";
import type { R2Config } from "./r2";

const ORG = "11111111-2222-3333-4444-555555555555";
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const ref = (sha: string) => `blob:sha256:${sha}`;
const R2: R2Config = { accountId: "0123456789abcdef0123456789abcdef", accessKeyId: "k", secretAccessKey: "s", bucket: "weft-blobs" };

// A client whose blob_mirror holds `mirrored` and whose storage signs every path but `missing`.
function fakeClient(opts: { mirrored?: string[]; mirrorError?: boolean; mirrorThrows?: boolean; missing?: string[]; signError?: boolean; signThrows?: boolean } = {}) {
  const inFilter = vi.fn();
  const createSignedUrls = vi.fn((paths: string[]) => {
    if (opts.signThrows) throw new Error("boom");
    if (opts.signError) return Promise.resolve({ data: null, error: { message: "denied" } });
    return Promise.resolve({
      data: paths.map((p) => ({ path: p, signedUrl: opts.missing?.some((m) => p.endsWith(m)) ? null : `https://sb.test/sign/${p}` })),
      error: null,
    });
  });
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_col: string, shas: string[]) => {
            inFilter(shas);
            if (opts.mirrorThrows) throw new Error("no table");
            if (opts.mirrorError) return Promise.resolve({ data: null, error: { message: "relation does not exist" } });
            return Promise.resolve({ data: shas.filter((s) => opts.mirrored?.includes(s)).map((sha) => ({ sha })), error: null });
          },
        }),
      }),
    }),
    storage: { from: () => ({ createSignedUrls }) },
  };
  return { client: client as unknown as SupabaseClient, createSignedUrls, inFilter };
}

describe("mirroredShas", () => {
  it("answers the shas blob_mirror has", async () => {
    const { client } = fakeClient({ mirrored: [A] });
    expect(await mirroredShas(client, ORG, [A, B])).toEqual(new Set([A]));
  });

  it("is empty for no shas, an error, or a missing table", async () => {
    const { client, inFilter } = fakeClient({ mirrored: [A] });
    expect(await mirroredShas(client, ORG, [])).toEqual(new Set());
    expect(inFilter).not.toHaveBeenCalled();
    expect(await mirroredShas(fakeClient({ mirrorError: true }).client, ORG, [A])).toEqual(new Set());
    expect(await mirroredShas(fakeClient({ mirrorThrows: true }).client, ORG, [A])).toEqual(new Set());
  });
});

describe("resolveBlobUrls", () => {
  it("answers nothing for no refs", async () => {
    const { client, createSignedUrls } = fakeClient();
    expect(await resolveBlobUrls(client, ORG, [], { r2: R2 })).toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("signs R2 for mirrored blobs and Supabase for the rest, and queues the rest", async () => {
    const { client, createSignedUrls } = fakeClient({ mirrored: [A] });
    const onUnmirrored = vi.fn();
    const urls = await resolveBlobUrls(client, ORG, [ref(A), ref(B)], { r2: R2, onUnmirrored, now: Date.UTC(2026, 9, 29, 16) });
    expect(urls[ref(A)]).toMatch(new RegExp(`^https://${R2.accountId}\\.r2\\.cloudflarestorage\\.com/weft-blobs/${ORG}/${A}\\?X-Amz-`));
    expect(urls[ref(B)]).toBe(`https://sb.test/sign/${ORG}/${B}`);
    expect(createSignedUrls).toHaveBeenCalledWith([`${ORG}/${B}`], 3600);
    expect(onUnmirrored).toHaveBeenCalledWith([B]);
  });

  it("skips Supabase when every blob is in R2", async () => {
    const { client, createSignedUrls } = fakeClient({ mirrored: [A, B] });
    const onUnmirrored = vi.fn();
    const urls = await resolveBlobUrls(client, ORG, [ref(A), ref(B)], { r2: R2, onUnmirrored });
    expect(Object.keys(urls)).toHaveLength(2);
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect(onUnmirrored).not.toHaveBeenCalled();
  });

  it("uses Supabase alone with R2 off, and queues nothing", async () => {
    const { client, inFilter } = fakeClient({ mirrored: [A] });
    const onUnmirrored = vi.fn();
    const urls = await resolveBlobUrls(client, ORG, [ref(A)], { r2: null, onUnmirrored });
    expect(urls[ref(A)]).toBe(`https://sb.test/sign/${ORG}/${A}`);
    expect(inFilter).not.toHaveBeenCalled();
    expect(onUnmirrored).not.toHaveBeenCalled();
  });

  it("reads R2's settings from the environment by default", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "");
    const { client, inFilter } = fakeClient({ mirrored: [A] });
    await resolveBlobUrls(client, ORG, [ref(A)]);
    expect(inFilter).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("leaves out what nobody can sign, and survives a failing batch", async () => {
    const missing = await resolveBlobUrls(fakeClient({ missing: [C] }).client, ORG, [ref(B), ref(C)], { r2: R2 });
    expect(Object.keys(missing)).toEqual([ref(B)]);
    expect(await resolveBlobUrls(fakeClient({ signError: true }).client, ORG, [ref(B)], { r2: R2 })).toEqual({});
    const onUnmirrored = vi.fn();
    expect(await resolveBlobUrls(fakeClient({ signThrows: true }).client, ORG, [ref(B)], { r2: R2, onUnmirrored })).toEqual({});
    expect(onUnmirrored).not.toHaveBeenCalled();
  });
});
