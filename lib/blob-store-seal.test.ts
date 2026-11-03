// lib/blob-store.ts with a seal (lib/blob-seal.ts): every byte that goes up through a sealed upload, a page's assets
// and its rewritten copy included, goes through the seal under the plaintext's sha, and the ref stays that sha.
import { describe, expect, it, vi } from "vitest";
import type { ThreadItem } from "./types";
import { BLOB_REF_PREFIX } from "./cloud-sync-types";
import { file, makeClient, sha, store, withBlobDirs } from "./blob-store.harness";

withBlobDirs();

const seal = vi.fn((org: string, s: string, bytes: Uint8Array) => Buffer.concat([Buffer.from(`sealed:${org}:${s.slice(0, 4)}:`), Buffer.from(bytes)]));

describe("a sealed upload", () => {
  it("puts the sealed bytes under the plaintext's sha, as the file's type", async () => {
    const p = file("shot.png", "PNGbytes");
    const m = makeClient();
    expect(await store(m).upload(p, "orgA", seal)).toBe(`${BLOB_REF_PREFIX}${sha("PNGbytes")}`);
    expect(seal).toHaveBeenCalledWith("orgA", sha("PNGbytes"), Buffer.from("PNGbytes"));
    expect(m.uploadCalls[0]).toEqual({ path: `orgA/${sha("PNGbytes")}`, body: Buffer.from(`sealed:orgA:${sha("PNGbytes").slice(0, 4)}:PNGbytes`), opts: { contentType: "image/png", upsert: false } });
  });

  it("seals a page's assets and its rewritten copy", async () => {
    file(".weft/show/t/shot.png", "png-bytes");
    const p = file(".weft/show/t/index.html", `<img src="shot.png">`);
    const m = makeClient();
    const ref = await store(m).uploadPage(p, "orgA", seal);
    const sent = `<img src="${BLOB_REF_PREFIX}${sha("png-bytes")}">`;
    expect(ref).toBe(`${BLOB_REF_PREFIX}${sha(sent)}`);
    expect(m.uploadCalls.map((c) => c.body.toString().startsWith("sealed:orgA:"))).toEqual([true, true]);
    expect(m.uploadCalls[1]?.body.toString()).toContain(sent);
  });

  it("seals a non-HTML page and one naming nothing local", async () => {
    const m = makeClient();
    await store(m).uploadPage(file("doc.pdf", "%PDF"), "orgA", seal);
    await store(m).uploadPage(file("plain.html", "<p>hi</p>"), "orgA", seal);
    expect(m.uploadCalls.map((c) => c.body.toString())).toEqual([`sealed:orgA:${sha("%PDF").slice(0, 4)}:%PDF`, `sealed:orgA:${sha("<p>hi</p>").slice(0, 4)}:<p>hi</p>`]);
  });

  it("seals what an item names: tool images, an opened page, a user page, markdown pictures", async () => {
    const m = makeClient();
    const s = store(m);
    const img = file("a.png", "A");
    const page = file(".weft/show/p.html", "<p>p</p>");
    const pic = file("b.png", "B");
    const shot = file("c.png", "C");
    const tool: ThreadItem = { kind: "tool", id: "t", name: "mcp__browser__open_url", summary: page, at: 1, images: [img] };
    await s.rewriteItem(tool, "orgA", seal);
    await s.rewriteItem({ kind: "user", text: `![b](${pic})`, at: 1, page: file(".weft/show/q.html", "<p>q</p>") }, "orgA", seal);
    await s.rewriteItem({ kind: "assistant", text: `![c](${shot})`, at: 1 }, "orgA", seal);
    expect(m.uploadCalls).toHaveLength(5);
    expect(m.uploadCalls.every((c) => c.body.toString().startsWith("sealed:orgA:"))).toBe(true);
  });

  it("puts plain bytes without a seal, as before", async () => {
    const m = makeClient();
    await store(m).upload(file("p.png", "plain"), "orgA");
    expect(m.uploadCalls[0]?.body).toEqual(Buffer.from("plain"));
  });
});
