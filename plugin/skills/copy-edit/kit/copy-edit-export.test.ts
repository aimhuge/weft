// @vitest-environment jsdom
// The copy-edit kit's export (copy-edit-export.js): the piece as markdown with its images named in reading order, one
// .zip for the user, and the same files handed to window.weft.showExport for the export/ folder beside the page.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SRC = fs.readFileSync(path.join(__dirname, "copy-edit-export.js"), "utf8");
const PNG = "data:image/png;base64," + Buffer.from("png-bytes").toString("base64");
const JPG = "data:image/jpeg;base64," + Buffer.from("jpg-bytes").toString("base64");

type Exporter = { sync: () => void; markdown: () => string };
type Win = Window & { CopyEditExport: (api: { doc: HTMLElement; toast: (s: string) => void }) => Exporter; weft?: unknown };

function page(body: string) {
  document.title = "Editor — Let's dance";
  document.body.innerHTML = `<header><button id="copy">Copy text</button></header><article id="doc" data-key="riemann-essay-v2">${body}</article>`;
  vm.runInThisContext(SRC);
  const toast = vi.fn();
  const doc = document.getElementById("doc")!;
  return { doc, toast, api: (window as unknown as Win).CopyEditExport({ doc, toast }) };
}
const fig = (src: string, cap: string, cls = "") => `<figure class="${cls}"><img src="${src}"><div class="fig-tools"></div><figcaption>${cap}</figcaption></figure>`;

const BODY = [
  `<p><span class="tag">Regarding the first question</span>Listen. The <mark data-n="1">Riemann</mark> Hypothesis appears solved.</p>`,
  fig(JPG, "Bernhard Riemann’s 1859 paper, page one"),
  `<ol><li>Is it true?</li><li>Does it matter?</li></ol>`,
  fig(PNG, "Let's dance. (Illustration, AI-generated.)", "cover"),
  `<p>Line one<br>line two</p>`,
  fig("img-coal.png", ""),
].join("");

beforeEach(() => { delete (window as unknown as Win).weft; localStorage.clear(); });
afterEach(() => vi.useRealTimers());

describe("markdown", () => {
  it("puts the title and cover first, captions italic, labels bold, lists numbered, marks unwrapped", () => {
    const { api } = page(BODY);
    expect(api.markdown()).toBe([
      "---\ntitle: \"Let's dance\"\n---",
      "![Let's dance. (Illustration, AI-generated.)](images/01-cover-lets-dance-illustration-ai-generated.png)\n*Let's dance. (Illustration, AI-generated.)*",
      "**Regarding the first question**\nListen. The Riemann Hypothesis appears solved.",
      "![Bernhard Riemann’s 1859 paper, page one](images/02-bernhard-riemanns-1859-paper-page.jpg)\n*Bernhard Riemann’s 1859 paper, page one*",
      "1. Is it true?\n2. Does it matter?",
      "Line one\nline two",
      "![](images/03-image.png)",
    ].join("\n\n") + "\n");
  });
  it("keeps H1 and H2 as # and ##, and links as [text](url)", () => {
    const { api } = page(`<h1>AI has solved math</h1><p>See <a href="https://weft.zip">Weft</a>.</p><h2>Question 1</h2>`);
    expect(api.markdown()).toBe("---\ntitle: \"Let's dance\"\n---\n\n# AI has solved math\n\nSee [Weft](https://weft.zip).\n\n## Question 1\n");
  });
  it("adds the Export button once, before Copy text", () => {
    page("<p>x</p>");
    expect(document.getElementById("export")?.nextElementSibling?.id).toBe("copy");
  });
});

describe("Substack header and footer", () => {
  it("shows both around the text, keeps what's typed for every piece, and puts them around the body with dividers", () => {
    page("<p>Body.</p>");
    const head = document.querySelector<HTMLElement>(".frame-header")!, foot = document.querySelector<HTMLElement>(".frame-footer")!;
    expect(head.nextElementSibling?.id).toBe("doc");
    expect(foot.previousElementSibling?.id).toBe("doc");
    head.innerText = "Hi, I'm Alex.";
    head.dispatchEvent(new Event("input"));
    foot.innerText = "Subscribe for more.";
    foot.dispatchEvent(new Event("input"));
    const { api } = page("<p>Another piece.</p>");
    expect(api.markdown()).toBe("---\ntitle: \"Let's dance\"\n---\n\nHi, I'm Alex.\n\n---\n\nAnother piece.\n\n---\n\nSubscribe for more.\n");
  });
  it("leaves them out when empty", () => {
    expect(page("<p>Body.</p>").api.markdown()).toBe("---\ntitle: \"Let's dance\"\n---\n\nBody.\n");
  });
  it("keeps an image already on the web as its link, with no file", async () => {
    vi.useFakeTimers();
    const showExport = vi.fn(() => Promise.resolve({ ok: true }));
    Object.assign(window, { weft: { showExport } });
    const { api } = page(fig("https://cdn.example.com/a.png", "Remote") + fig(PNG, "Local"));
    expect(api.markdown()).toContain("![Remote](https://cdn.example.com/a.png)");
    api.sync();
    await vi.advanceTimersByTimeAsync(1300);
    const [files] = showExport.mock.calls[0] as unknown as [{ name: string }[]];
    expect(files.map((f) => f.name)).toEqual(["piece.md", "images/02-local.png"]);
  });
});

describe("export beside the page", () => {
  it("hands Weft piece.md, data images as base64 and file images by their src, after a pause", async () => {
    vi.useFakeTimers();
    const showExport = vi.fn(() => Promise.resolve({ ok: true }));
    Object.assign(window, { weft: { showExport } });
    const { api } = page(BODY);
    api.sync();
    api.sync();
    await vi.advanceTimersByTimeAsync(1300);
    expect(showExport).toHaveBeenCalledTimes(1);
    const [files] = showExport.mock.calls[0] as unknown as [{ name: string; text?: string; base64?: string; from?: string }[]];
    expect(files.map((f) => f.name)).toEqual(["piece.md", "images/01-cover-lets-dance-illustration-ai-generated.png",
      "images/02-bernhard-riemanns-1859-paper-page.jpg", "images/03-image.png"]);
    expect(Buffer.from(files[1]?.base64 ?? "", "base64").toString()).toBe("png-bytes");
    expect(files[3]?.from).toBe("img-coal.png");
  });
  it("does nothing outside Weft", async () => {
    vi.useFakeTimers();
    const { api } = page(BODY);
    api.sync();
    await vi.advanceTimersByTimeAsync(1300);
    expect((window as unknown as Win).weft).toBeUndefined();
  });
});

describe("Export button", () => {
  it("downloads one zip with piece.md and every image", async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return "blob:x"; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("riemann-essay.zip");
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ arrayBuffer: () => Promise.resolve(new TextEncoder().encode("file-bytes").buffer) })));
    const { toast } = page(BODY);
    document.getElementById("export")!.click();
    await vi.waitFor(() => expect(toast).toHaveBeenCalled());
    expect(click).toHaveBeenCalledOnce();
    const files = unzipSync(new Uint8Array(await blob!.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["piece.md", "images/01-cover-lets-dance-illustration-ai-generated.png",
      "images/02-bernhard-riemanns-1859-paper-page.jpg", "images/03-image.png"]);
    expect(strFromU8(files["piece.md"] ?? new Uint8Array())).toMatch(/^---\ntitle: "Let's dance"\n---\n\n!\[/);
    expect(strFromU8(files["images/02-bernhard-riemanns-1859-paper-page.jpg"] ?? new Uint8Array())).toBe("jpg-bytes");
    expect(strFromU8(files["images/03-image.png"] ?? new Uint8Array())).toBe("file-bytes");
    expect(toast).toHaveBeenCalledWith("Exported piece.md + 3 images");
    vi.unstubAllGlobals();
    click.mockRestore();
  });
});
