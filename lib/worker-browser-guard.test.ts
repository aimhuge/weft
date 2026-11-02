// What the worker's browser may load, against a real folder tree: the rule follows symlinks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileRoots, mayLoad, mayLoadFile, navigable, refusal } from "./worker-browser-guard";

let base: string;
let wh: string;
let show: string;
let work: string;
let roots: string[];

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wbg-")));
  wh = path.join(base, ".weft-worker");
  show = path.join(wh, "data", "show");
  work = path.join(wh, "work");
  fs.mkdirSync(show, { recursive: true });
  fs.mkdirSync(path.join(work, "app", ".git"), { recursive: true });
  for (const f of [path.join(show, "plan.html"), path.join(work, "app", "index.html"), path.join(work, "app", ".git", "x.html"), path.join(work, "app", ".env.html"), path.join(wh, "worker.json"), path.join(show, "data.json")]) fs.writeFileSync(f, "x");
  fs.symlinkSync(path.join(wh, "worker.json"), path.join(show, "link.html"));
  roots = [show, work];
  vi.spyOn(os, "homedir").mockReturnValue(base);
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(base, { recursive: true, force: true });
});

const url = (file: string) => `file://${file}`;

describe("mayLoad", () => {
  it("lets the web and this box's dev servers through, and what a page makes for itself", () => {
    for (const u of ["https://example.com", "http://localhost:3000/x", "ws://127.0.0.1:5173", "about:blank", "data:text/html,hi", "blob:http://localhost/1", "chrome-error://chromewebdata/"]) expect(mayLoad(u, roots)).toBe(true);
  });

  it("opens a web file in the show folder or a checkout", () => {
    expect(mayLoad(url(path.join(show, "plan.html")), roots)).toBe(true);
    expect(mayLoad(url(path.join(work, "app", "index.html")), roots)).toBe(true);
  });

  it("never a secret, a link to one, a dot folder, a non-web file, or anything outside the roots", () => {
    for (const file of [path.join(wh, "worker.json"), path.join(show, "link.html"), path.join(work, "app", ".git", "x.html"), path.join(work, "app", ".env.html"), path.join(show, "data.json"), "/etc/hosts"]) {
      expect(mayLoad(url(file), roots)).toBe(false);
    }
  });

  it("refuses other schemes and what doesn't parse", () => {
    for (const u of ["chrome://settings", "view-source:https://a.test", "devtools://x", "javascript:alert(1)", "not a url", "file://host%zz/x"]) expect(mayLoad(u, roots)).toBe(false);
    expect(mayLoadFile("file:///%E0%A4%A", roots)).toBe(false);
  });
});

describe("fileRoots", () => {
  it("is the show folder and the worker's work root", () => {
    vi.stubEnv("WEFT_WORKER_HOME", wh);
    vi.stubEnv("WEFT_WORKER_ROOT", "");
    expect(fileRoots()[1]).toBe(work);
    expect(fileRoots({ WEFT_WORKER_HOME: wh, WEFT_WORKER_ROOT: "/srv/work" } as unknown as NodeJS.ProcessEnv)[1]).toBe("/srv/work");
    expect(mayLoad(url(path.join(work, "app", "index.html")))).toBe(true);
  });
});

describe("navigable", () => {
  it("makes a path a file: URL, gives a bare host a scheme, and leaves a URL alone", () => {
    expect(navigable(" /a b/plan.html ")).toBe("file:///a%20b/plan.html");
    expect(navigable("localhost:3000")).toBe("http://localhost:3000");
    expect(navigable("127.0.0.1")).toBe("http://127.0.0.1");
    expect(navigable("example.com/x")).toBe("https://example.com/x");
    expect(navigable("http://a.test")).toBe("http://a.test");
  });
});

describe("refusal", () => {
  it("says what a file may be, or which schemes open", () => {
    expect(refusal("file:///etc/hosts")).toMatch(/only web files .* show folder or a checkout/);
    expect(refusal("chrome://settings")).toMatch(/http, https and allowed files only/);
  });
});
