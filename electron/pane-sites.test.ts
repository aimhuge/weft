// electron/pane-sites.cjs: which hosts a thread opens in the pane without asking, and the saved yeses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaneSites, hostOf, isLocalHost, isTopSite, SIGNED_IN } from "./pane-sites.cjs";
import top from "./pane-top-sites.json";

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pane-sites-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("isLocalHost", () => {
  it("takes this Mac's own servers", () => {
    for (const host of ["localhost", "app.localhost", "127.0.0.1", "127.1.2.3", "[::1]", "0.0.0.0"]) expect(isLocalHost(host)).toBe(true);
  });

  it("refuses look-alikes", () => {
    for (const host of ["localhost.evil.com", "127.0.0.1.evil.com", "10.0.0.1", "mylocalhost"]) expect(isLocalHost(host)).toBe(false);
  });
});

describe("isTopSite", () => {
  it("ships a thousand sites", () => {
    expect(top.sites).toHaveLength(1000);
  });

  it("takes a public top site at its bare domain and www.", () => {
    expect(isTopSite("google.com")).toBe(true);
    expect(isTopSite("www.google.com")).toBe(true);
    expect(isTopSite("www.wikipedia.org")).toBe(true);
  });

  it("asks for a top site's other subdomains", () => {
    expect(isTopSite("mail.google.com")).toBe(false);
    expect(isTopSite("drive.google.com")).toBe(false);
  });

  it("asks for the signed-in sites, even when they're in the top 1000", () => {
    for (const domain of ["paypal.com", "amazon.com", "github.com", "tiktok.com", "facebook.com"]) {
      expect(top.sites).toContain(domain);
      expect(SIGNED_IN.has(domain)).toBe(true);
      expect(isTopSite(domain)).toBe(false);
      expect(isTopSite(`www.${domain}`)).toBe(false);
    }
  });

  it("asks for a site that isn't in the list", () => {
    expect(isTopSite("some-tiny-blog.example")).toBe(false);
  });
});

describe("hostOf", () => {
  it("reads a bare domain or a whole URL", () => {
    expect(hostOf("TikTok.com")).toBe("tiktok.com");
    expect(hostOf(" https://www.tiktok.com/@x?y=1 ")).toBe("www.tiktok.com");
    expect(hostOf("example.com:8443")).toBe("example.com");
  });

  it("gives \"\" for what isn't a site", () => {
    for (const input of ["", "   ", "nope", "http://", "file:///tmp/a.html", null, undefined]) expect(hostOf(input)).toBe("");
  });
});

describe("createPaneSites", () => {
  it("allows local, top and saved hosts, and asks for the rest", () => {
    const sites = createPaneSites(tempDir());
    expect(sites.allows("localhost")).toBe(true);
    expect(sites.allows("www.google.com")).toBe(true);
    expect(sites.allows("tiktok.com")).toBe(false);
    expect(sites.add("https://tiktok.com/foryou")).toBe("tiktok.com");
    expect(sites.allows("tiktok.com")).toBe(true);
  });

  it("keeps the saved hosts across restarts, sorted", () => {
    const dir = tempDir();
    const first = createPaneSites(dir);
    first.add("b.example.com");
    first.add("a.example.com");
    expect(createPaneSites(dir).list()).toEqual(["a.example.com", "b.example.com"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "pane-sites.json"), "utf8"))).toEqual({ sites: ["a.example.com", "b.example.com"] });
  });

  it("refuses to save what isn't a site", () => {
    const dir = tempDir();
    expect(createPaneSites(dir).add("not a site")).toBe(null);
    expect(fs.existsSync(path.join(dir, "pane-sites.json"))).toBe(false);
  });

  it("removes a host, and says when there was none to remove", () => {
    const dir = tempDir();
    const sites = createPaneSites(dir);
    sites.add("tiktok.com");
    expect(sites.remove("tiktok.com")).toBe(true);
    expect(sites.allows("tiktok.com")).toBe(false);
    expect(sites.remove("tiktok.com")).toBe(false);
    expect(createPaneSites(dir).list()).toEqual([]);
  });

  it("starts empty from a missing, broken or odd file", () => {
    const dir = tempDir();
    expect(createPaneSites(dir).list()).toEqual([]);
    fs.writeFileSync(path.join(dir, "pane-sites.json"), "{not json");
    expect(createPaneSites(dir).list()).toEqual([]);
    fs.writeFileSync(path.join(dir, "pane-sites.json"), JSON.stringify({ sites: "x" }));
    expect(createPaneSites(dir).list()).toEqual([]);
    fs.writeFileSync(path.join(dir, "pane-sites.json"), JSON.stringify({ sites: ["ok.com", 3] }));
    expect(createPaneSites(dir).list()).toEqual(["ok.com"]);
  });
});
