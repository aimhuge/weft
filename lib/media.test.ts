import { describe, expect, it } from "vitest";
import { ATTACHMENT_NAME, MEDIA_REF, attachmentName, extensionOf, mediaKind, mediaMarkdown, mediaUrl } from "./media";

describe("extensionOf", () => {
  it("returns the lowercased extension", () => {
    expect(extensionOf("/a/Shot.PNG")).toBe("png");
    expect(extensionOf("clip.tar.gz")).toBe("gz");
  });

  it("ignores a query string or hash", () => {
    expect(extensionOf("https://x.com/a.jpg?w=10")).toBe("jpg");
    expect(extensionOf("https://x.com/a.webp#top")).toBe("webp");
  });

  it("is empty when there's no dot in the last segment", () => {
    expect(extensionOf("/a.dir/README")).toBe("");
    expect(extensionOf("noext")).toBe("");
  });
});

describe("mediaKind", () => {
  it("sorts by extension", () => {
    expect(mediaKind("a.png")).toBe("image");
    expect(mediaKind("a.svg")).toBe("image");
    expect(mediaKind("a.mov")).toBe("video");
    expect(mediaKind("a.opus")).toBe("audio");
    expect(mediaKind("a.pdf")).toBe("file");
    expect(mediaKind("a")).toBe("file");
  });

  it("takes a signed link to a synced blob, which has no extension, for an image", () => {
    const sha = "a".repeat(64);
    expect(mediaKind(`https://x.supabase.co/storage/v1/object/sign/weft-blobs/org/${sha}?token=t`)).toBe("image");
    const r2 = `https://${"0".repeat(32)}.r2.cloudflarestorage.com/weft-blobs/11111111-2222-3333-4444-555555555555/${"a".repeat(64)}?X-Amz-Algorithm=AWS4-HMAC-SHA256`;
    expect(mediaKind(r2)).toBe("image");
    expect(mediaKind(r2.replace("?", "/x?"))).toBe("file");
    // Any other extensionless link stays a file.
    expect(mediaKind("https://x.com/download")).toBe("file");
  });
});

describe("ATTACHMENT_NAME", () => {
  it("accepts saved names and rejects paths or odd names", () => {
    expect(ATTACHMENT_NAME.test("shot-1a2b3c4d.png")).toBe(true);
    expect(ATTACHMENT_NAME.test("../etc/passwd")).toBe(false);
    expect(ATTACHMENT_NAME.test("-x.png")).toBe(false);
    expect(ATTACHMENT_NAME.test("Shot.png")).toBe(false);
    expect(ATTACHMENT_NAME.test("x.toolongext")).toBe(false);
  });
});

describe("MEDIA_REF", () => {
  it("matches plain and angle-bracketed refs", () => {
    const text = "see ![a](/x/a.png) and ![b c](</x/b c.png>) but not [d](/x/d.png)";
    const refs = [...text.matchAll(MEDIA_REF)].map((m) => [m[1], m[2] ?? m[3]]);
    expect(refs).toEqual([
      ["a", "/x/a.png"],
      ["b c", "/x/b c.png"],
    ]);
  });
});

describe("attachmentName", () => {
  it("returns the file name for a path in an attachments folder", () => {
    expect(attachmentName("/Users/me/.weft/attachments/shot-1a2b.png")).toBe("shot-1a2b.png");
  });

  it("is null outside an attachments folder or for a bad name", () => {
    expect(attachmentName("/Users/me/shot.png")).toBeNull();
    expect(attachmentName("/x/attachments/Bad Name.png")).toBeNull();
    expect(attachmentName("/x/attachments/sub/a.png")).toBeNull();
  });
});

describe("mediaUrl", () => {
  it("maps an attachment path to the API route", () => {
    expect(mediaUrl("/h/.weft/attachments/a-1.png")).toBe("/api/attachments/a-1.png");
  });

  it("passes web URLs through", () => {
    expect(mediaUrl("https://x.com/a.png")).toBe("https://x.com/a.png");
    expect(mediaUrl("http://x.com/a.png")).toBe("http://x.com/a.png");
  });

  it("is null for any other path", () => {
    expect(mediaUrl("/tmp/a.png")).toBeNull();
    expect(mediaUrl("file:///tmp/a.png")).toBeNull();
  });
});

describe("mediaMarkdown", () => {
  it("writes an image ref", () => {
    expect(mediaMarkdown("shot.png", "/a/shot.png")).toBe("![shot.png](/a/shot.png)");
  });

  it("wraps a path with spaces in angle brackets", () => {
    expect(mediaMarkdown("shot", "/a b/shot.png")).toBe("![shot](</a b/shot.png>)");
  });

  it("strips brackets and newlines from the alt text, falling back to 'attachment'", () => {
    expect(mediaMarkdown("a[1]\nb", "/a.png")).toBe("![a 1  b](/a.png)");
    expect(mediaMarkdown(" [] ", "/a.png")).toBe("![attachment](/a.png)");
  });
});
