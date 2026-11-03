// weft.zip's pasted files (lib/web-upload.ts): up to the blob store under their sha, named so a host takes them, and
// listed on the row whose text pastes them.
import { describe, expect, it, vi } from "vitest";
import type { NewCommand } from "./cloud-commands";
import { rowCard, travelName, webUploads, withAttachmentRefs, withAttachments } from "./web-upload";

const SHA = "ab".repeat(32);
const blob = (bytes: number, type = "image/png") => new Blob([new Uint8Array(bytes)], { type });

function setup(problem: string | null = null) {
  const put = vi.fn<(sha: string, bytes: ArrayBuffer | Uint8Array, mime: string) => Promise<string | null>>(() => Promise.resolve(problem));
  const uploads = webUploads({ orgId: "o", put, digest: () => Promise.resolve(SHA), preview: () => "blob:preview" });
  return { put, uploads };
}

describe("travelName", () => {
  it("names a file <slug>-<sha8>.<ext>, by its extension or else its type", () => {
    expect(travelName("Screen Shot 2026.PNG", "", SHA)).toBe("screen-shot-2026-abababab.png");
    expect(travelName("image", "image/jpeg", SHA)).toBe("image-abababab.jpeg");
    expect(travelName("---.pdf", "", SHA)).toBe("paste-abababab.pdf");
    expect(travelName("a".repeat(40) + "-b.webp", "", SHA)).toBe(`${"a".repeat(32)}-abababab.webp`);
  });

  it("has no name for a type that doesn't travel", () => {
    expect(travelName("clip.mov", "video/quicktime", SHA)).toBeNull();
  });
});

describe("webUploads", () => {
  it("puts the bytes under their sha and answers a path the text can name", async () => {
    const { put, uploads } = setup();
    const progress = vi.fn();
    const got = await uploads.upload(blob(3), "shot.png", progress);
    expect(put).toHaveBeenCalledWith(SHA, expect.any(ArrayBuffer), "image/png");
    expect(got).toEqual({ name: "shot-abababab.png", path: "/attachments/shot-abababab.png", url: "blob:preview", kind: "image", bytes: 3 });
    expect(progress).toHaveBeenCalledWith(1);
  });

  it("refuses a file too big, of a type that doesn't travel, or one the store wouldn't take", async () => {
    await expect(setup().uploads.upload(blob(25 * 1024 ** 2 + 1), "big.png")).rejects.toThrow("too big");
    await expect(setup().uploads.upload(blob(1, "video/mp4"), "a.mp4")).rejects.toThrow("Only images and PDFs");
    await expect(setup("denied").uploads.upload(blob(1), "a.png")).rejects.toThrow("Couldn't upload a.png: denied");
  });

  it("lists the refs a text pastes that it uploaded, once each", async () => {
    const { uploads } = setup();
    await uploads.upload(blob(1), "a.png");
    const text = "look ![a](/attachments/a-abababab.png) and ![a](/attachments/a-abababab.png) ![b](/attachments/other-12345678.png)";
    expect(uploads.refsFor(text)).toEqual([{ name: "a-abababab.png", sha: SHA, mime: "image/png" }]);
  });

  it("refuses more files in one message than a host takes", async () => {
    const shas = Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(64, "0"));
    const uploads = webUploads({ orgId: "o", put: () => Promise.resolve(null), digest: () => Promise.resolve(shas.shift()!), preview: () => "" });
    let text = "";
    for (let i = 0; i < 21; i++) text += `![x](${(await uploads.upload(blob(1), `f${i}.png`)).path}) `;
    expect(() => uploads.refsFor(text)).toThrow("up to 20 files");
  });

  it("uses the browser's own digest and object URLs by default", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    const put = vi.fn(() => Promise.resolve(null));
    const got = await webUploads({ orgId: "o", put }).upload(blob(0), "e.png");
    expect(got.name).toBe("e-e3b0c442.png");
    expect(got.url).toBe("blob:x");
    created.mockRestore();
  });
});

describe("withAttachmentRefs", () => {
  const refs = { refsFor: (text: string) => (text.includes("![") ? [{ name: "a-1.png", sha: SHA, mime: "image/png" }] : []) };
  const row = (payload: object): NewCommand => ({ org_id: "o", kind: "reply", target_device: "d", folder: "f", payload: payload as NewCommand["payload"] });

  it("lists the files on a reply, a new card and a host verb's text or message", () => {
    for (const payload of [{ text: "![a](x)" }, { prompt: "![a](x)" }, { args: { text: "![a](x)" } }, { args: { message: "![a](x)" } }]) {
      expect(withAttachmentRefs(row(payload), refs).payload).toMatchObject({ attachments: [{ name: "a-1.png" }] });
    }
  });

  it("leaves a row that pastes nothing as it was", () => {
    const plain = row({ text: "hi" });
    expect(withAttachmentRefs(plain, refs)).toBe(plain);
    const none = row({ cardId: "c" });
    expect(withAttachmentRefs(none, refs)).toBe(none);
  });
});

describe("held files (a browser that holds a workspace key)", () => {
  const held = (problem: string | null = null) => {
    const put = vi.fn<(sha: string, bytes: ArrayBuffer | Uint8Array, mime: string) => Promise<string | null>>(() => Promise.resolve(problem));
    return { put, uploads: webUploads({ orgId: "o", put, holds: () => true, digest: () => Promise.resolve(SHA), preview: () => "" }) };
  };
  const ref = { name: "a-abababab.png", sha: SHA, mime: "image/png" };

  it("waits for the message, then puts each file once, sealed with the card's seal", async () => {
    const { put, uploads } = held();
    await uploads.upload(blob(2), "a.png");
    expect(put).not.toHaveBeenCalled();
    const seal = vi.fn((org: string, sha: string, bytes: Uint8Array) => new Uint8Array([org.length, sha.length, bytes.length]));
    await uploads.send([ref], seal);
    expect(seal).toHaveBeenCalledWith("o", SHA, new Uint8Array(2));
    expect(put).toHaveBeenCalledWith(SHA, new Uint8Array([1, 64, 2]), "image/png");
    await uploads.send([ref], null);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("puts plain without a seal, and says why one couldn't go", async () => {
    const { put, uploads } = held();
    await uploads.upload(blob(1), "a.png");
    await uploads.send([ref, { ...ref, sha: "cd".repeat(32) }], null);
    expect(put).toHaveBeenCalledWith(SHA, expect.any(ArrayBuffer), "image/png");
    const failing = held("denied");
    await failing.uploads.upload(blob(1), "a.png");
    await expect(failing.uploads.send([ref], null)).rejects.toThrow("Couldn't upload a-abababab.png: denied");
  });
});

describe("withAttachments", () => {
  const row = (payload: object): NewCommand => ({ org_id: "o", kind: "reply", target_device: "d", folder: "f", payload: payload as NewCommand["payload"] });
  const ref = { name: "a-1.png", sha: SHA, mime: "image/png" };

  it("lists the files and sends them with the seal for the row's card", async () => {
    const send = vi.fn(() => Promise.resolve());
    const seal = () => new Uint8Array();
    const sealFor = vi.fn(() => seal);
    const got = await withAttachments(row({ cardId: "c1", text: "![a](x)" }), { refsFor: () => [ref], send }, sealFor);
    expect(got.payload).toMatchObject({ attachments: [ref] });
    expect(sealFor).toHaveBeenCalledWith("c1");
    expect(send).toHaveBeenCalledWith([ref], seal);
  });

  it("sends nothing for a row that pastes nothing", async () => {
    const send = vi.fn(() => Promise.resolve());
    const plain = row({ text: "hi" });
    expect(await withAttachments(plain, { refsFor: () => [], send }, () => null)).toBe(plain);
    expect(send).not.toHaveBeenCalled();
  });

  it("finds the card on a reply, a host verb, or none", () => {
    expect(rowCard(row({ cardId: "c1" }))).toBe("c1");
    expect(rowCard(row({ verb: "card.fresh", args: { id: "c2" } }))).toBe("c2");
    expect(rowCard(row({ verb: "settings.get", args: { id: "" } }))).toBeNull();
    expect(rowCard(row({ prompt: "new" }))).toBeNull();
  });
});
