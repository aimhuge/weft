// lib/app-preview.ts: the link preview's pure helpers — what a page says about itself, what the
// author wrote, what Haiku made of it, and which of those the preview keeps. Every branch of the
// module is pinned here, because the row weft.zip reads is only as trustworthy as this cleaning.
import { describe, expect, it } from "vitest";
import {
  authorPreview,
  blobRefSha,
  cleanImage,
  cleanPreview,
  cleanText,
  descriptionPrompt,
  mergePreview,
  MIN_TEXT_FOR_SUMMARY,
  pageMeta,
  pageText,
  parseDescription,
  PREVIEW_DESCRIPTION_MAX,
  PREVIEW_TITLE_MAX,
} from "./app-preview";

const BLOB = `blob:sha256:${"a".repeat(64)}`;

describe("cleanText", () => {
  it("keeps a short string as it is", () => {
    expect(cleanText("Hello there", 80)).toBe("Hello there");
  });

  it("collapses whitespace and trims", () => {
    expect(cleanText("  Hello \n\t there  ", 80)).toBe("Hello there");
  });

  it("returns undefined for a non-string, or for text with nothing in it", () => {
    expect(cleanText(undefined, 80)).toBeUndefined();
    expect(cleanText(42, 80)).toBeUndefined();
    expect(cleanText({ toString: () => "x" }, 80)).toBeUndefined();
    expect(cleanText("   ", 80)).toBeUndefined();
  });

  it("decodes the named entities", () => {
    expect(cleanText("a &amp; b &lt;c&gt; &quot;q&quot; &apos;s&apos; &nbsp;x", 100)).toBe("a & b <c> \"q\" 's' x");
  });

  it("decodes a named entity whatever its case, and leaves an unknown one alone", () => {
    expect(cleanText("&AMP;", 100)).toBe("&");
    expect(cleanText("&bogus; x", 100)).toBe("&bogus; x");
  });

  it("decodes decimal and hex code points", () => {
    expect(cleanText("&#65;&#x42;", 100)).toBe("AB");
    expect(cleanText("&#x41;", 100)).toBe("A");
    expect(cleanText("&#X41;", 100)).toBe("A");
  });

  it("leaves a code point outside the Unicode range alone", () => {
    expect(cleanText("&#0;&#x110000;", 100)).toBe("&#0;&#x110000;");
  });

  it("cuts at a word and adds an ellipsis", () => {
    expect(cleanText("word one two three four five six seven eight nine ten", 30)).toBe("word one two three four five…");
  });

  it("drops a trailing comma or dash before the ellipsis", () => {
    expect(cleanText("Hello there, friend.", 15)).toBe("Hello there…");
  });

  it("cuts mid-word when the word is longer than half the cap", () => {
    expect(cleanText("supercalifragilistic", 10)).toBe("supercali…");
  });

  it("keeps the partial word when what came before it is too short", () => {
    expect(cleanText("x y zzzzzzzz", 6)).toBe("x y z…");
  });

  it("keeps a string of exactly the cap", () => {
    expect(cleanText("12345", 5)).toBe("12345");
  });
});

describe("cleanImage", () => {
  it("keeps an https address", () => {
    expect(cleanImage("https://example.com/a.png")).toBe("https://example.com/a.png");
  });

  it("refuses a plain http address", () => {
    expect(cleanImage("http://example.com/a.png")).toBeUndefined();
  });

  it("keeps a blob ref as it is", () => {
    expect(cleanImage(BLOB)).toBe(BLOB);
  });

  it("refuses a blob ref that isn't well formed", () => {
    expect(cleanImage("blob:sha256:short")).toBeUndefined();
  });

  it("refuses something that isn't a url at all", () => {
    expect(cleanImage("not a url")).toBeUndefined();
    expect(cleanImage("/local/path.png")).toBeUndefined();
  });

  it("refuses an address longer than 2000 characters", () => {
    expect(cleanImage(`https://example.com/${"a".repeat(2000)}`)).toBeUndefined();
  });

  it("refuses a non-string", () => {
    expect(cleanImage(42)).toBeUndefined();
    expect(cleanImage(null)).toBeUndefined();
  });
});

describe("pageText", () => {
  it("keeps the page's visible text and drops scripts, styles and comments", () => {
    expect(pageText("<script>bad()</script><style>x{}</style><!--c--><p>Hello</p>")).toBe("Hello");
  });

  it("drops a noscript, template, svg and head block too", () => {
    expect(pageText("<head><title>T</title></head><noscript>no</noscript><template>x</template><svg><text>s</text></svg><p>Kept</p>")).toBe("Kept");
  });

  it("returns an empty string for a page with no text", () => {
    expect(pageText("<div></div>")).toBe("");
  });

  it("cuts the text at 4000 characters without an ellipsis", () => {
    const text = pageText("word ".repeat(2000));
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text.endsWith("…")).toBe(false);
  });
});

describe("pageMeta", () => {
  it("prefers Open Graph's tags", () => {
    const meta = pageMeta("<meta property='og:title' content='OG'><meta property='og:description' content='OGD'><meta property='og:image' content='https://x/i.png'>");
    expect(meta).toMatchObject({ title: "OG", description: "OGD", image: "https://x/i.png" });
  });

  it("falls back to Twitter's tags", () => {
    const meta = pageMeta("<meta name='twitter:title' content='TW'><meta name='twitter:description' content='TWD'><meta name='twitter:image' content='https://x/t.png'>");
    expect(meta).toMatchObject({ title: "TW", description: "TWD", image: "https://x/t.png" });
  });

  it("falls back to the plain title and description", () => {
    const meta = pageMeta("<html><head><title>Hi</title><meta name='description' content='D'></head><body>x</body></html>");
    expect(meta).toMatchObject({ title: "Hi", description: "D" });
    expect(meta.text).toBe("x");
  });

  it("reads a tag whose content comes before its property", () => {
    expect(pageMeta("<meta content='C' property='og:title'>").title).toBe("C");
  });

  it("reads single-quoted and unquoted attributes", () => {
    expect(pageMeta("<meta property='og:title' content='S'>").title).toBe("S");
    expect(pageMeta("<meta property=og:title content=Hello>").title).toBe("Hello");
  });

  it("takes the first of each tag", () => {
    expect(pageMeta("<meta property='og:title' content='A'><meta property='og:title' content='B'>").title).toBe("A");
  });

  it("skips a tag with no content, and one whose content is blank", () => {
    expect(pageMeta("<meta property='og:title'>").title).toBeUndefined();
    expect(pageMeta("<meta property='og:title' content='   '><title>Fallback</title>").title).toBe("Fallback");
  });

  it("takes the first image variant it finds", () => {
    expect(pageMeta("<meta property='og:image:url' content='https://x/u.png'>").image).toBe("https://x/u.png");
    expect(pageMeta("<meta property='og:image:secure_url' content='https://x/s.png'>").image).toBe("https://x/s.png");
    expect(pageMeta("<meta name='twitter:image:src' content='https://x/i.png'>").image).toBe("https://x/i.png");
  });

  it("leaves the title and description off when the page says nothing", () => {
    const meta = pageMeta("<div>hi</div>");
    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.image).toBeUndefined();
  });
});

describe("authorPreview", () => {
  it("reads the title, description and image", () => {
    expect(authorPreview({ title: " T ", description: " D ", image: " i.png " })).toEqual({ title: "T", description: "D", image: "i.png" });
  });

  it("leaves out what the author didn't write", () => {
    expect(authorPreview({ title: "T" })).toEqual({ title: "T" });
  });

  it("drops an empty image", () => {
    expect(authorPreview({ image: "  " })).toEqual({});
  });

  it("returns nothing for a non-object", () => {
    expect(authorPreview(null)).toEqual({});
    expect(authorPreview("nope")).toEqual({});
    expect(authorPreview([1])).toEqual({});
  });
});

describe("descriptionPrompt", () => {
  it("asks for one sentence about the app, with the page's text", () => {
    const prompt = descriptionPrompt("Growth", "retention by cohort");
    expect(prompt).toContain('called "Growth"');
    expect(prompt).toContain("at most 25 words");
    expect(prompt).toContain("The page's text:");
    expect(prompt.endsWith("retention by cohort")).toBe(true);
  });

  it("cuts the page's text at 4000 characters", () => {
    const prompt = descriptionPrompt("App", "x".repeat(5000));
    expect(prompt.length).toBeLessThan(5000);
  });
});

describe("parseDescription", () => {
  it("takes Haiku's sentence", () => {
    expect(parseDescription("A dashboard for retention by cohort.")).toBe("A dashboard for retention by cohort.");
  });

  it("strips a Description: label and the quotes around the sentence", () => {
    expect(parseDescription("Description: \"A nice app.\"")).toBe("A nice app.");
    expect(parseDescription("Sentence: 'A nice app.'")).toBe("A nice app.");
  });

  it("takes the first line that has something on it", () => {
    expect(parseDescription("\n\n  A nice app.\nAnother line.")).toBe("A nice app.");
  });

  it("refuses a refusal", () => {
    expect(parseDescription("I'm sorry, I can't do that.")).toBeUndefined();
    expect(parseDescription("I cannot help with this")).toBeUndefined();
    expect(parseDescription("Sorry, no.")).toBeUndefined();
    expect(parseDescription("As an AI I can't describe it")).toBeUndefined();
  });

  it("refuses a question back", () => {
    expect(parseDescription("What is the app for?")).toBeUndefined();
  });

  it("refuses an empty reply", () => {
    expect(parseDescription("   \n  ")).toBeUndefined();
  });

  it("caps the sentence", () => {
    const sentence = parseDescription("word ".repeat(100));
    expect(sentence!.length).toBeLessThanOrEqual(PREVIEW_DESCRIPTION_MAX);
    expect(sentence!.endsWith("…")).toBe(true);
  });
});

describe("mergePreview", () => {
  it("keeps the dialog's description over every other one", () => {
    const preview = mergePreview({
      you: { description: "Y" },
      app: { title: "AT", description: "AD", image: "AI" },
      page: { title: "PT", description: "PD", image: "PI" },
      weft: { description: "W" },
    });
    expect(preview.description).toBe("Y");
    expect(preview.by?.description).toBe("you");
  });

  it("prefers the app's title and image over the page's", () => {
    const preview = mergePreview({
      app: { title: "AT", image: "https://x/app.png" },
      page: { title: "PT", image: "https://x/page.png" },
    });
    expect(preview.title).toBe("AT");
    expect(preview.image).toBe("https://x/app.png");
    expect(preview.by).toEqual({ title: "app", image: "app" });
  });

  it("falls back to the page's title and image", () => {
    const preview = mergePreview({ page: { title: "PT", image: "https://x/page.png" } });
    expect(preview.title).toBe("PT");
    expect(preview.image).toBe("https://x/page.png");
    expect(preview.by).toEqual({ title: "page", image: "page" });
  });

  it("falls back through app, page and weft for the description", () => {
    expect(mergePreview({ app: { description: "AD" }, page: { description: "PD" }, weft: { description: "W" } })).toMatchObject({ description: "AD", by: { description: "app" } });
    expect(mergePreview({ page: { description: "PD" }, weft: { description: "W" } })).toMatchObject({ description: "PD", by: { description: "page" } });
    expect(mergePreview({ weft: { description: "W" } })).toMatchObject({ description: "W", by: { description: "weft" } });
  });

  it("carries the shot and the page it was made from", () => {
    const preview = mergePreview({ weft: { description: "W" }, shot: BLOB, of: "https://example.com/page" });
    expect(preview.shot).toBe(BLOB);
    expect(preview.of).toBe("https://example.com/page");
  });

  it("is empty when there is nothing to merge", () => {
    expect(mergePreview({})).toEqual({});
  });
});

describe("cleanPreview", () => {
  it("keeps the good fields and drops the rest", () => {
    const preview = cleanPreview({
      title: "T",
      description: "D",
      image: "https://x/i.png",
      shot: BLOB,
      of: "https://example.com/page",
      by: { title: "you", description: "nope" },
    });
    expect(preview).toEqual({
      title: "T",
      description: "D",
      image: "https://x/i.png",
      shot: BLOB,
      of: "https://example.com/page",
      by: { title: "you" },
    });
  });

  it("drops a picture that isn't https or a blob ref", () => {
    expect(cleanPreview({ image: "http://x/i.png" })).toBeNull();
    expect(cleanPreview({ image: "/local/i.png" })).toBeNull();
  });

  it("drops a shot that isn't a blob ref", () => {
    expect(cleanPreview({ shot: "https://x/i.png" })).toBeNull();
  });

  it("drops an of longer than 2100 characters", () => {
    expect(cleanPreview({ of: "a".repeat(2101) })).toBeNull();
    expect(cleanPreview({ of: "a".repeat(2100) })).toEqual({ of: "a".repeat(2100) });
  });

  it("drops a by that isn't an object, and a source it doesn't know", () => {
    expect(cleanPreview({ title: "T", by: "you" })).toEqual({ title: "T" });
    expect(cleanPreview({ title: "T", by: { title: "nope" } })).toEqual({ title: "T" });
  });

  it("returns null for a non-object, an array, or nothing left", () => {
    expect(cleanPreview(null)).toBeNull();
    expect(cleanPreview(undefined)).toBeNull();
    expect(cleanPreview("x")).toBeNull();
    expect(cleanPreview([1])).toBeNull();
    expect(cleanPreview({})).toBeNull();
  });
});

describe("blobRefSha", () => {
  it("names the sha a blob ref points at", () => {
    expect(blobRefSha(BLOB)).toBe("a".repeat(64));
  });

  it("returns null for anything that isn't a blob ref", () => {
    expect(blobRefSha("blob:sha256:short")).toBeNull();
    expect(blobRefSha("https://example.com")).toBeNull();
    expect(blobRefSha(undefined)).toBeNull();
  });
});

describe("the caps", () => {
  it("are the ones the preview is written against", () => {
    expect(PREVIEW_TITLE_MAX).toBe(80);
    expect(PREVIEW_DESCRIPTION_MAX).toBe(200);
    expect(MIN_TEXT_FOR_SUMMARY).toBe(40);
  });
});
