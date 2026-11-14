import { describe, expect, it } from "vitest";
import { appEditTarget } from "./app-edit";

describe("appEditTarget", () => {
  it("opens a local app's own folder with a draft naming it", () => {
    const t = appEditTarget({ name: "📈 Growth", url: "file:///Users/me/.weft/apps/growth/index.html" });
    expect(t?.folder).toBe("/Users/me/.weft/apps/growth");
    expect(t?.draft).toContain('"📈 Growth"');
    expect(t?.draft).toContain("/Users/me/.weft/apps/growth/index.html");
    expect(t?.draft.endsWith("What to change: ")).toBe(true);
  });

  it("decodes a path with spaces", () => {
    expect(appEditTarget({ name: "A", url: "file:///Users/me/My%20Apps/x.html" })?.folder).toBe("/Users/me/My Apps");
  });

  it("gives a file at the root the root", () => {
    expect(appEditTarget({ name: "A", url: "file:///x.html" })?.folder).toBe("/");
  });

  it("has nothing for a web app or a bad address", () => {
    expect(appEditTarget({ name: "A", url: "https://example.com" })).toBeNull();
    expect(appEditTarget({ name: "A", url: "http://localhost:3000" })).toBeNull();
    expect(appEditTarget({ name: "A", url: "not a url" })).toBeNull();
  });
});
