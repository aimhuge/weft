import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contentTypeFor, findMarkdownLocalPaths, isLocalUploadPath, resolveLocalPath, resolvePage } from "./blob-paths";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "weft-blob-paths-"));
const file = (name: string) => {
  const p = path.join(HOME, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "x");
  return p;
};

describe("isLocalUploadPath", () => {
  it("refuses empty, relative, and outside-home paths", () => {
    expect(isLocalUploadPath("", HOME)).toBe(false);
    expect(isLocalUploadPath("relative/x.png", HOME)).toBe(false);
    expect(isLocalUploadPath("/etc/passwd", HOME)).toBe(false);
  });
  it("accepts a file under the home directory", () => {
    expect(isLocalUploadPath(path.join(HOME, "a.png"), HOME)).toBe(true);
  });
  it("decodes file:// URLs before the check", () => {
    const p = path.join(HOME, "x.png");
    expect(isLocalUploadPath(`file://${p}`, HOME)).toBe(true);
    expect(isLocalUploadPath("file:///etc/passwd", HOME)).toBe(false);
  });
  it("refuses .env files, the device key, account files, token files, and the vault", () => {
    for (const n of [".env", ".env.local", "device-key.json", "account.json", "account.sealed", "puku-trial-token", "shell-token", "github-token.json"]) {
      expect(isLocalUploadPath(path.join(HOME, n), HOME)).toBe(false);
    }
    expect(isLocalUploadPath(path.join(HOME, ".weft", "vault", "x.json"), HOME)).toBe(false);
    expect(isLocalUploadPath(path.join(HOME, ".weft", "vault"), HOME)).toBe(false);
  });
  it("defaults home to the user's home directory", () => {
    expect(isLocalUploadPath(path.join(os.homedir(), "a.png"))).toBe(true);
  });
});

describe("resolveLocalPath", () => {
  it("leaves http, localhost, empty and missing paths alone, resolves a real file", () => {
    const p = file("r.png");
    expect(resolveLocalPath("", HOME)).toBeNull();
    expect(resolveLocalPath("https://x.test/a.png", HOME)).toBeNull();
    expect(resolveLocalPath("ws://localhost:3000/a", HOME)).toBeNull();
    expect(resolveLocalPath(path.join(HOME, "gone.png"), HOME)).toBeNull();
    expect(resolveLocalPath(`file://${p}`, HOME)).toBe(p);
    expect(resolveLocalPath(path.join(os.homedir(), "surely-not-here.png"))).toBeNull();
  });
});

describe("resolvePage", () => {
  it("splits a #hash off a file:// URL or a path and keeps it verbatim", () => {
    const p = file(".weft/show/x/index.html");
    expect(resolvePage(`file://${p}#step-2`, HOME)).toEqual({ local: p, hash: "#step-2" });
    expect(resolvePage(`${p}#a#b`, HOME)).toEqual({ local: p, hash: "#a#b" });
    expect(resolvePage(`file://${p}`, HOME)).toEqual({ local: p, hash: "" });
  });
  it("splits a ?query (a cache-buster) off too, keeping it with the #hash", () => {
    const p = file(".weft/show/rfp/index.html");
    expect(resolvePage(`file://${p}?v=2#founders`, HOME)).toEqual({ local: p, hash: "?v=2#founders" });
    expect(resolvePage(`${p}?v=3`, HOME)).toEqual({ local: p, hash: "?v=3" });
  });
  it("prefers a file whose name holds a '#'", () => {
    const p = file("odd#name.html");
    expect(resolvePage(p, HOME)).toEqual({ local: p, hash: "" });
  });
  it("returns null for http, a bare #hash, a missing file and a secret", () => {
    file(".env");
    expect(resolvePage("https://x.test/#a", HOME)).toBeNull();
    expect(resolvePage("#only", HOME)).toBeNull();
    expect(resolvePage(`${path.join(HOME, "nope.html")}#a`, HOME)).toBeNull();
    expect(resolvePage(`${path.join(HOME, ".env")}#a`, HOME)).toBeNull();
    expect(resolvePage(`${path.join(os.homedir(), "surely-not-here.html")}#a`)).toBeNull();
  });
});

describe("contentTypeFor and findMarkdownLocalPaths", () => {
  it("maps known extensions and falls back to octet-stream", () => {
    expect(contentTypeFor("a.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("a.bin")).toBe("application/octet-stream");
  });
  it("returns one entry per target, empty when it can't be uploaded", () => {
    const p = file("m.png");
    expect(findMarkdownLocalPaths(`![a](${p}) ![b](https://x.test/b.png) ![c](<${p}>)`, HOME)).toEqual([p, "", p]);
  });
});
