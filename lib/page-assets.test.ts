// lib/page-assets.ts: a single-file page's relative assets go up with it (the valentine page's us.webp case).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appPage } from "./app-share";
import { APP_FOLDER_MAX_FILE_BYTES } from "./app-folder";
import { pageAssets, pageWithAssets, relativeAssetPath } from "./page-assets";

const withTmpHome = (fn: (home: string, dir: string) => void) => {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-page-assets-")));
  const dir = path.join(home, ".weft", "show", "valentine");
  fs.mkdirSync(dir, { recursive: true });
  try { fn(home, dir); } finally { fs.rmSync(home, { recursive: true, force: true }); }
};

describe("relativeAssetPath", () => {
  it("keeps plain relative paths and drops the query and hash", () => {
    expect(relativeAssetPath("us.webp")).toBe("us.webp");
    expect(relativeAssetPath("./img/a.png?v=2#x")).toBe("img/a.png");
    expect(relativeAssetPath("img%2Fa.png")).toBe("img/a.png");
  });

  it("refuses schemes, absolute paths, climbing, hidden and unservable names", () => {
    for (const ref of ["https://x.com/a.png", "data:image/png;base64,AA", "mailto:a@b.c", "//cdn/a.js", "/abs.png",
      "#top", "", "../up.png", "a/../../up.png", ".env", "dir/.secret", "has space.png", "%E0%A4%A", "."]) {
      expect(relativeAssetPath(ref)).toBeNull();
    }
  });
});

describe("pageAssets", () => {
  it("finds src, href, poster, srcset and css url() files that exist, once each", () => {
    withTmpHome((home, dir) => {
      for (const f of ["us.webp", "a.css", "b.png", "c.png", "v.jpg", "font.woff2", "app.js"]) fs.writeFileSync(path.join(dir, f), f);
      fs.writeFileSync(path.join(dir, "index.html"), `<link href="a.css"><img src="us.webp"><img src='us.webp'>
        <img srcset="b.png 1x, c.png 2x"><video poster=v.jpg></video><script src="app.js"></script>
        <style>@font-face{src:url("font.woff2")}</style><img src="missing.png"><a href="#top">x</a>
        <img src="https://x.com/y.png"><a href="index.html">self</a>`);
      expect(pageAssets(path.join(dir, "index.html"), home).map((f) => f.relative))
        .toEqual(["a.css", "us.webp", "v.jpg", "app.js", "b.png", "c.png", "font.woff2"]);
    });
  });

  it("skips non-html entries, unreadable pages, folders, secrets, oversize files and symlinks out", () => {
    withTmpHome((home, dir) => {
      expect(pageAssets(path.join(dir, "x.png"), home)).toEqual([]);
      expect(pageAssets(path.join(dir, "gone.html"), home)).toEqual([]);
      fs.mkdirSync(path.join(dir, "sub"));
      fs.writeFileSync(path.join(dir, "gh-token"), "x");
      fs.writeFileSync(path.join(dir, "big.bin"), "");
      fs.truncateSync(path.join(dir, "big.bin"), APP_FOLDER_MAX_FILE_BYTES + 1);
      const outside = path.join(home, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "o.png"), "o");
      fs.symlinkSync(outside, path.join(dir, "link"));
      fs.writeFileSync(path.join(dir, "index.html"), `<img src="sub"><img src="gh-token"><img src="big.bin"><img src="link/o.png">`);
      expect(pageAssets(path.join(dir, "index.html"), home)).toEqual([]);
    });
  });
});

describe("appPage for a single-file page with a sibling image", () => {
  it("shares the page as a folder of itself plus the image", () => {
    withTmpHome((home, dir) => {
      const page = path.join(dir, "index.html");
      fs.writeFileSync(page, `<img src="us.webp" alt="us">`);
      fs.writeFileSync(path.join(dir, "us.webp"), "RIFF");
      fs.writeFileSync(path.join(dir, "other.html"), "unrelated page");
      expect(appPage(`file://${page}`, home)).toEqual({
        kind: "folder", folder: dir, entry: "index.html", manifest: {},
        files: [
          { absolute: page, relative: "index.html", size: fs.statSync(page).size },
          { absolute: path.join(dir, "us.webp"), relative: "us.webp", size: 4 },
        ],
      });
    });
  });

  it("stays a blob, hash and all, when the page links to nothing beside it", () => {
    withTmpHome((home, dir) => {
      const page = path.join(dir, "index.html");
      fs.writeFileSync(page, `<img src="data:image/png;base64,AA">`);
      expect(appPage(`file://${page}#step`, home)).toEqual({ kind: "blob", local: page, hash: "#step" });
    });
  });

  it("stays a blob when the page's own name isn't one the folder route serves", () => {
    withTmpHome((home, dir) => {
      const page = path.join(dir, "my page.html");
      fs.writeFileSync(page, `<img src="us.webp">`);
      fs.writeFileSync(path.join(dir, "us.webp"), "RIFF");
      expect(pageWithAssets(page, home)).toBeNull();
    });
  });
});
