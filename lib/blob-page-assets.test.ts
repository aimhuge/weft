// lib/blob-page-assets.ts: a page's local images, videos, stylesheets and CSS url()s are uploaded and named by
// their blob refs in the uploaded copy; web URLs, data: URIs, secrets and missing files stay as written.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { type AssetUpload, MAX_ASSET_BYTES, resolveAssetPath, rewritePageHtml } from "./blob-page-assets";
import type { BlobRef } from "./cloud-sync-types";

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-page-assets-")));
const SHOW = path.join(HOME, ".weft", "show", "tour");
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

const put = (rel: string, body = "x") => {
  const p = path.join(HOME, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
};
const page = put(".weft/show/tour/index.html");
// A fake upload: each file's ref is its name, so the assertions read.
const refOf = (local: string): BlobRef => `blob:sha256:${path.basename(local).replace(/\W/g, "")}`;
const fakeUpload = () => vi.fn((local: string) => Promise.resolve(refOf(local)));
const rewrite = (html: string, upload: AssetUpload = fakeUpload()) => rewritePageHtml(html, page, upload, HOME);

put(".weft/show/tour/shot.png");
put(".weft/show/tour/clip.mp4");
put(".weft/show/tour/poster.jpg");
put(".weft/show/tour/a b.png");
put(".weft/show/tour/2x.png");
put(".weft/show/tour/icons.svg");
put(".weft/show/tour/app.js");
put(".weft/show/tour/favicon.ico");
put(".weft/show/shared/bg.png");
put(".weft/show/tour/css/site.css", `body{background:url(../shared-local.png)} .x{background:url('img/dot.png')}`);
put(".weft/show/tour/css/img/dot.png");
put(".weft/show/tour/.env.local", "KEY=1");

describe("resolveAssetPath", () => {
  it("resolves relative, ./, ../, %-encoded and file:// references under home", () => {
    expect(resolveAssetPath("shot.png", SHOW, HOME)).toBe(path.join(SHOW, "shot.png"));
    expect(resolveAssetPath("./shot.png?v=2#top", SHOW, HOME)).toBe(path.join(SHOW, "shot.png"));
    expect(resolveAssetPath("../shared/bg.png", SHOW, HOME)).toBe(path.join(HOME, ".weft/show/shared/bg.png"));
    expect(resolveAssetPath("a%20b.png", SHOW, HOME)).toBe(path.join(SHOW, "a b.png"));
    expect(resolveAssetPath(`file://${SHOW}/shot.png#x`, SHOW, HOME)).toBe(path.join(SHOW, "shot.png"));
    expect(resolveAssetPath(`${SHOW}/shot.png`, SHOW, HOME)).toBe(path.join(SHOW, "shot.png"));
  });

  it("leaves web URLs, data:, blob refs, fragments, missing files, secrets and folders out", () => {
    for (const raw of ["", "  ", "https://x.dev/a.png", "//cdn.dev/a.png", "data:image/png;base64,AA", "blob:sha256:ab", "#top", "mailto:a@b", "nope.png", ".env.local", "css", "%zz.png"]) {
      expect(resolveAssetPath(raw, SHOW, HOME)).toBeNull();
    }
    expect(resolveAssetPath("../../../../../etc/hosts", SHOW, HOME)).toBeNull();
  });

  it("leaves a file over the size cap out", () => {
    const big = put(".weft/show/tour/big.mp4");
    fs.truncateSync(big, MAX_ASSET_BYTES + 1);
    expect(resolveAssetPath("big.mp4", SHOW, HOME)).toBeNull();
    fs.rmSync(big);
  });
});

describe("rewritePageHtml", () => {
  it("returns null for a page that names nothing local", async () => {
    const upload = fakeUpload();
    expect(await rewrite(`<img src="https://x.dev/a.png"><a href="shot.png">link</a><img src="nope.png">`, upload)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("swaps src, poster and srcset values for refs, keeping each quote style", async () => {
    const out = await rewrite(
      `<img src="shot.png" alt=x><img src='a%20b.png'><img src=shot.png>` +
        `<video poster="poster.jpg"><source src="./clip.mp4" type="video/mp4"></video>` +
        `<img srcset="shot.png 1x, 2x.png 2x, https://x.dev/3.png 3x"><script src="app.js"></script><img data-src="shot.png">`,
    );
    expect(out).toBe(
      `<img src="blob:sha256:shotpng" alt=x><img src='blob:sha256:abpng'><img src=blob:sha256:shotpng>` +
        `<video poster="blob:sha256:posterjpg"><source src="blob:sha256:clipmp4" type="video/mp4"></video>` +
        `<img srcset="blob:sha256:shotpng 1x, blob:sha256:2xpng 2x, https://x.dev/3.png 3x"><script src="blob:sha256:appjs"></script><img data-src="shot.png">`,
    );
  });

  it("uploads a file once however often the page names it, and keeps an SVG #fragment", async () => {
    const upload = fakeUpload();
    const out = await rewrite(`<img src="shot.png"><img src="./shot.png"><img src="icons.svg#star">`, upload);
    expect(out).toBe(`<img src="blob:sha256:shotpng"><img src="blob:sha256:shotpng"><img src="blob:sha256:iconssvg#star">`);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("rewrites url() in <style> blocks and style attributes", async () => {
    const out = await rewrite(`<style>.a{background:url("shot.png")} .b{background:url(https://x.dev/a.png)}</style><div style="background:url(../shared/bg.png)"></div><p style='background:url(shot.png)'></p>`);
    expect(out).toBe(
      `<style>.a{background:url("blob:sha256:shotpng")} .b{background:url(https://x.dev/a.png)}</style>` +
        `<div style="background:url('blob:sha256:bgpng')"></div><p style='background:url("blob:sha256:shotpng")'></p>`,
    );
  });

  it("inlines a local stylesheet with its own url()s read against its folder, and keeps its media", async () => {
    const out = await rewrite(`<link rel="stylesheet" href="css/site.css" media="print"><link rel=stylesheet href="https://cdn.dev/a.css"><link rel="stylesheet" href="shot.png">`);
    expect(out).toContain(`<style media="print">\nbody{background:url(../shared-local.png)} .x{background:url("blob:sha256:dotpng")}\n</style>`);
    expect(out).toContain(`<link rel=stylesheet href="https://cdn.dev/a.css">`);
    expect(out).toContain(`<link rel="stylesheet" href="shot.png">`);
  });

  it("escapes a </style inside an inlined stylesheet", async () => {
    put(".weft/show/tour/css/evil.css", `/* </style><script>x</script> */`);
    const out = await rewrite(`<link href="css/evil.css" rel="stylesheet">`);
    expect(out).toBe(`<style>\n/* <\\/style><script>x</script> */\n</style>`);
  });

  it("rewrites an icon link's href and leaves other links and href-less links alone", async () => {
    const out = await rewrite(`<link rel="icon" href="favicon.ico"><link rel="canonical" href="shot.png"><link rel="icon">`);
    expect(out).toBe(`<link rel="icon" href="blob:sha256:faviconico"><link rel="canonical" href="shot.png"><link rel="icon">`);
  });

  it("leaves a reference as written when its upload fails or gives no ref", async () => {
    const upload = vi.fn((local: string) => (local.endsWith("shot.png") ? Promise.reject(new Error("413")) : Promise.resolve(null)));
    expect(await rewrite(`<img src="shot.png"><img src="poster.jpg"><img srcset="shot.png 1x">`, upload)).toBeNull();
  });

  it("uses the real home directory by default", async () => {
    expect(await rewritePageHtml(`<img src="https://x.dev/a.png">`, page, fakeUpload())).toBeNull();
  });
});
