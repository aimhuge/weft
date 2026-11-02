import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TRAVEL_BYTES, MAX_TRAVEL_FILES, attachmentsOf, encodeAttachments, pastedNames, receiveAttachments } from "./attachment-transfer";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const PNG = Buffer.from("png bytes");
const SHA = sha(PNG);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "travel-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("pastedNames", () => {
  it("lists each attachment a message pastes once, angled paths included, and nothing else", () => {
    const text = "a ![s](/Users/me/.weft/attachments/shot-1.png) b ![s](</x/y z/attachments/doc-2.pdf>) ![s](/Users/me/.weft/attachments/shot-1.png) ![w](https://x.dev/a.png) ![p](/tmp/plain.png)";
    expect(pastedNames(text)).toEqual(["shot-1.png", "doc-2.pdf"]);
  });
});

describe("encodeAttachments", () => {
  it("uploads each pasted file in the folder and lists it", async () => {
    fs.writeFileSync(path.join(dir, "shot-1.png"), PNG);
    const upload = vi.fn(() => Promise.resolve(SHA));
    const refs = await encodeAttachments("look ![s](/Users/me/.weft/attachments/shot-1.png) ![g](/elsewhere/attachments/gone-2.png)", dir, upload);
    expect(refs).toEqual([{ name: "shot-1.png", sha: SHA, mime: "image/png" }]);
    expect(upload).toHaveBeenCalledWith(path.join(dir, "shot-1.png"));
  });

  it("sends nothing for a plain message", async () => {
    const upload = vi.fn();
    expect(await encodeAttachments("just words", dir, upload)).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a type a worker doesn't take, a file that's too big, and a failed upload", async () => {
    fs.writeFileSync(path.join(dir, "clip-1.mov"), "m");
    await expect(encodeAttachments("![c](/a/attachments/clip-1.mov)", dir, () => Promise.resolve(SHA))).rejects.toThrow(/Only images and PDFs reach a worker, so clip-1.mov/);
    fs.writeFileSync(path.join(dir, "big-1.png"), "");
    fs.truncateSync(path.join(dir, "big-1.png"), MAX_TRAVEL_BYTES + 1);
    await expect(encodeAttachments("![b](/a/attachments/big-1.png)", dir, () => Promise.resolve(SHA))).rejects.toThrow(/big-1.png is over 25 MB/);
    fs.writeFileSync(path.join(dir, "shot-1.png"), PNG);
    await expect(encodeAttachments("![s](/a/attachments/shot-1.png)", dir, () => Promise.resolve(null))).rejects.toThrow(/Couldn't upload shot-1.png/);
  });

  it("refuses more files than a message may carry", async () => {
    const text = Array.from({ length: MAX_TRAVEL_FILES + 1 }, (_, i) => `![s](/a/attachments/s-${i}.png)`).join(" ");
    await expect(encodeAttachments(text, dir, () => Promise.resolve(SHA))).rejects.toThrow(/up to 20 files/);
  });
});

describe("attachmentsOf", () => {
  it("keeps only well-formed refs whose type matches the name", () => {
    const good = { name: "shot-1.png", sha: SHA, mime: "image/png" };
    const payload = {
      attachments: [good, { name: "../x.png", sha: SHA, mime: "image/png" }, { name: "a-1.png", sha: "nope", mime: "image/png" }, { name: "a-1.png", sha: SHA, mime: "text/html" }, { name: "a-1.mov", sha: SHA, mime: "video/quicktime" }, { name: 1 }, null],
    };
    expect(attachmentsOf(payload)).toEqual([good]);
  });

  it("is null when there are none", () => {
    expect(attachmentsOf(null)).toBeNull();
    expect(attachmentsOf({})).toBeNull();
    expect(attachmentsOf({ attachments: [] })).toBeNull();
    expect(attachmentsOf({ attachments: "x" })).toBeNull();
    expect(attachmentsOf({ attachments: [{ name: "x" }] })).toBeNull();
  });

  it("reads no more than a message may carry", () => {
    const many = Array.from({ length: MAX_TRAVEL_FILES + 5 }, (_, i) => ({ name: `s-${i}.png`, sha: SHA, mime: "image/png" }));
    expect(attachmentsOf({ attachments: many })).toHaveLength(MAX_TRAVEL_FILES);
  });
});

describe("receiveAttachments", () => {
  const ref = { name: "shot-1.png", sha: SHA, mime: "image/png" };

  it("saves each file here and points the text at it", async () => {
    const download = vi.fn(() => Promise.resolve(PNG));
    const text = "see ![shot](/Users/me/.weft/attachments/shot-1.png) and ![o](/Users/me/.weft/attachments/other-2.png) ![w](https://x.dev/a.png)";
    const out = await receiveAttachments(text, [ref], dir, download);
    const file = path.join(dir, "shot-1.png");
    expect(out).toBe(`see ![shot](${file}) and ![o](/Users/me/.weft/attachments/other-2.png) ![w](https://x.dev/a.png)`);
    expect(fs.readFileSync(file)).toEqual(PNG);
    expect(download).toHaveBeenCalledWith(SHA);
  });

  it("keeps a path with spaces in one piece", async () => {
    const spaced = path.join(dir, "a b");
    const out = await receiveAttachments("![s](/x/attachments/shot-1.png)", [ref], spaced, () => Promise.resolve(PNG));
    expect(out).toBe(`![s](<${path.join(spaced, "shot-1.png")}>)`);
  });

  it("leaves the text alone with no refs", async () => {
    expect(await receiveAttachments("hi", null, dir, () => Promise.resolve(null))).toBe("hi");
  });

  it("doesn't rewrite a file that's already here with the same bytes, and replaces one that differs", async () => {
    const file = path.join(dir, "shot-1.png");
    fs.writeFileSync(file, PNG);
    const before = fs.statSync(file).mtimeMs;
    await receiveAttachments("x", [ref], dir, () => Promise.resolve(PNG));
    expect(fs.statSync(file).mtimeMs).toBe(before);
    fs.writeFileSync(file, "stale");
    await receiveAttachments("x", [ref], dir, () => Promise.resolve(PNG));
    expect(fs.readFileSync(file)).toEqual(PNG);
  });

  it("fails on a file that doesn't come, is too big, or isn't what was sent", async () => {
    await expect(receiveAttachments("x", [ref], dir, () => Promise.resolve(null))).rejects.toThrow(/Couldn't bring shot-1.png over/);
    await expect(receiveAttachments("x", [ref], dir, () => Promise.resolve(Buffer.alloc(MAX_TRAVEL_BYTES + 1)))).rejects.toThrow(/over 25 MB/);
    await expect(receiveAttachments("x", [ref], dir, () => Promise.resolve(Buffer.from("other")))).rejects.toThrow(/didn't arrive whole/);
    expect(fs.existsSync(path.join(dir, "shot-1.png"))).toBe(false);
  });
});
