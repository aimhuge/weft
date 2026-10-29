import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readBlob } from "./blob-read";
import type { R2Config } from "./r2";

const ORG = "11111111-2222-3333-4444-555555555555";
const SHA = "a".repeat(64);
const R2: R2Config = { accountId: "0123456789abcdef0123456789abcdef", accessKeyId: "k", secretAccessKey: "s", bucket: "weft-blobs" };

function client(blob: Blob | null) {
  const download = vi.fn().mockResolvedValue(blob ? { data: blob, error: null } : { data: null, error: { message: "Object not found" } });
  return { client: { storage: { from: () => ({ download }) } } as unknown as SupabaseClient, download };
}

describe("readBlob", () => {
  it("answers R2's bytes without touching Supabase", async () => {
    const { client: c, download } = client(new Blob(["sb"]));
    const fetchImpl = vi.fn().mockResolvedValue(new Response("r2", { status: 200, headers: { "content-type": "text/html" } }));
    const onUnmirrored = vi.fn();
    const got = await readBlob(c, ORG, SHA, { r2: R2, fetchImpl, onUnmirrored });
    expect(got?.from).toBe("r2");
    expect(got?.type).toBe("text/html");
    expect(new TextDecoder().decode(got?.bytes)).toBe("r2");
    expect(download).not.toHaveBeenCalled();
    expect(onUnmirrored).not.toHaveBeenCalled();
  });

  it("falls back to Supabase on an R2 miss and queues the copy", async () => {
    const { client: c, download } = client(new Blob(["sb"], { type: "image/png" }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const onUnmirrored = vi.fn();
    const got = await readBlob(c, ORG, SHA, { r2: R2, fetchImpl, onUnmirrored });
    expect(got).toMatchObject({ from: "supabase", type: "image/png" });
    expect(download).toHaveBeenCalledWith(`${ORG}/${SHA}`);
    expect(onUnmirrored).toHaveBeenCalledWith(SHA);
  });

  it("reads Supabase alone with R2 off, and queues nothing", async () => {
    const { client: c } = client(new Blob(["sb"]));
    const onUnmirrored = vi.fn();
    expect((await readBlob(c, ORG, SHA, { r2: null, onUnmirrored }))?.from).toBe("supabase");
    expect(onUnmirrored).not.toHaveBeenCalled();
  });

  it("is null when neither store has it", async () => {
    vi.stubEnv("WEFT_BLOBS_R2", "off");
    expect(await readBlob(client(null).client, ORG, SHA)).toBeNull();
    vi.unstubAllEnvs();
  });
});
