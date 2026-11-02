import { describe, expect, it } from "vitest";
import { extractReview, stepUrl } from "./review";

const block = (json: string) => "Done.\n```weft-review\n" + json + "\n```\nBOARD STATUS: column=review";

describe("extractReview", () => {
  it("parses a valid block and strips it", () => {
    const json = JSON.stringify({
      url: "http://localhost:3000",
      dev: "npm run dev",
      steps: [{ title: "Sign-in", look: "Wrong password shows an error", path: "/login" }],
    });
    const { text, review } = extractReview(block(json));
    expect(review).toEqual({
      url: "http://localhost:3000",
      dev: "npm run dev",
      steps: [{ title: "Sign-in", look: "Wrong password shows an error", path: "/login" }],
    });
    expect(text).toBe("Done.\nBOARD STATUS: column=review");
  });

  it("returns the text unchanged when there is no block", () => {
    expect(extractReview("nothing here\n")).toEqual({ text: "nothing here\n" });
  });

  it("drops a block with broken JSON but still strips it", () => {
    const { text, review } = extractReview(block("{not json"));
    expect(review).toBeUndefined();
    expect(text).not.toContain("weft-review");
  });

  it("rejects JSON without a steps array or with no usable steps", () => {
    expect(extractReview(block('{"url":"http://x"}')).review).toBeUndefined();
    expect(extractReview(block("[1,2]")).review).toBeUndefined();
    expect(extractReview(block("null")).review).toBeUndefined();
    expect(extractReview(block('{"steps":[]}')).review).toBeUndefined();
    expect(extractReview(block('{"steps":[{"look":"no title"},null,5]}')).review).toBeUndefined();
  });

  it("skips bad steps, trims strings and ignores non-string fields", () => {
    const { review } = extractReview(
      block('{"url":"  ","dev":7,"steps":[{"title":"  A  ","look":3},{"look":"x"},{"title":"B","url":"https://b.dev/p"}]}'),
    );
    expect(review).toEqual({
      url: undefined,
      dev: undefined,
      steps: [
        { title: "A", look: undefined, path: undefined },
        { title: "B", look: undefined, path: "https://b.dev/p" },
      ],
    });
  });

  it("prefers path over url on a step", () => {
    const { review } = extractReview(block('{"steps":[{"title":"A","path":"/a","url":"https://b"}]}'));
    expect(review?.steps[0]!.path).toBe("/a");
  });

  it("uses the last valid plan and strips every block", () => {
    const text = [block('{"steps":[{"title":"One"}]}'), block("oops"), block('{"steps":[{"title":"Two"}]}')].join("\n");
    const out = extractReview(text);
    expect(out.review?.steps[0]!.title).toBe("Two");
    expect(out.text).not.toContain("```");
  });

  it("keeps the earlier plan when a later block is broken", () => {
    const out = extractReview(block('{"steps":[{"title":"One"}]}') + "\n" + block("oops"));
    expect(out.review?.steps[0]!.title).toBe("One");
  });
});

describe("stepUrl", () => {
  const plan = { url: "http://localhost:3000", steps: [] };

  it("opens an uploaded page as itself, with its query and anchor", () => {
    const ref = `blob:sha256:${"c".repeat(64)}?tab=2#done`;
    expect(stepUrl(plan, { title: "t", path: ref })).toBe(ref);
  });

  it("joins a path onto the plan url", () => {
    expect(stepUrl(plan, { title: "t", path: "/login" })).toBe("http://localhost:3000/login");
    expect(stepUrl(plan, { title: "t", path: "settings?tab=1" })).toBe("http://localhost:3000/settings?tab=1");
  });

  it("falls back to the plan url when the step has no path", () => {
    expect(stepUrl(plan, { title: "t" })).toBe("http://localhost:3000");
  });

  it("returns undefined with neither a plan url nor a path", () => {
    expect(stepUrl({ steps: [] }, { title: "t" })).toBeUndefined();
    expect(stepUrl({ steps: [] }, { title: "t", path: "/login" })).toBeUndefined();
  });

  it("uses a full url as is", () => {
    expect(stepUrl(plan, { title: "t", path: "https://example.com/x" })).toBe("https://example.com/x");
  });

  it("turns absolute media/file paths into file urls", () => {
    expect(stepUrl(plan, { title: "t", path: "/tmp/report.pdf" })).toBe("file:///tmp/report.pdf");
    expect(stepUrl(plan, { title: "t", path: "/Users/me/my repo/SOUL.md" })).toBe("file:///Users/me/my%20repo/SOUL.md");
    expect(stepUrl(plan, { title: "t", path: "/Users/me/a#b.html" })).toBe("file:///Users/me/a%23b.html");
  });

  it("keeps an anchor or query on a local file as part of the url", () => {
    const show = "/Users/me/.weft/show/tour.html";
    expect(stepUrl(plan, { title: "t", path: show })).toBe(`file://${show}`);
    expect(stepUrl(plan, { title: "t", path: `${show}#built` })).toBe(`file://${show}#built`);
    expect(stepUrl(plan, { title: "t", path: `${show}?x=1#built` })).toBe(`file://${show}?x=1#built`);
    expect(stepUrl(plan, { title: "t", path: "/tmp/report.pdf#page=2" })).toBe("file:///tmp/report.pdf#page=2");
    expect(stepUrl(plan, { title: "t", path: "/Users/me/SOUL.md#conventions" })).toBe("file:///Users/me/SOUL.md#conventions");
  });

  it("encodes a literal # or ? that is part of the filename", () => {
    expect(stepUrl(plan, { title: "t", path: "/Users/me/a#b.html" })).toBe("file:///Users/me/a%23b.html");
    expect(stepUrl(plan, { title: "t", path: "/Users/me/a#b.html#sec" })).toBe("file:///Users/me/a%23b.html#sec");
    expect(stepUrl(plan, { title: "t", path: "/Users/me/what?.txt" })).toBe("file:///Users/me/what%3F.txt");
    expect(stepUrl(plan, { title: "t", path: "/Users/me/notes#1" })).toBe("file:///Users/me/notes%231");
  });

  it("leaves an app route with an anchor on the plan url", () => {
    expect(stepUrl(plan, { title: "t", path: "/settings#billing" })).toBe("http://localhost:3000/settings#billing");
  });

  it("keeps an app route that looks like a path as a route", () => {
    expect(stepUrl(plan, { title: "t", path: "/users/42" })).toBe("http://localhost:3000/users/42");
  });

  it("finds a page named only in the look text", () => {
    expect(stepUrl(plan, { title: "t", look: "Open https://example.com/docs, then scroll" })).toBe("https://example.com/docs");
    expect(stepUrl(plan, { title: "t", look: "Open /tmp/out/report.pdf and check page 2." })).toBe("file:///tmp/out/report.pdf");
  });
});

describe("stepUrl with a plan url that isn't a URL", () => {
  it("falls back to the plan's url as written instead of throwing", () => {
    expect(stepUrl({ url: "localhost:3000", steps: [] }, { title: "t", path: "login" })).toBe("localhost:3000");
  });
});
