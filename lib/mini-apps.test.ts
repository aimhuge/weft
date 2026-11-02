import { describe, expect, it } from "vitest";
import {
  MAX_APP_NAME,
  appFor,
  appGlyph,
  appMenu,
  appNameFrom,
  blobPageSha,
  cleanAppName,
  cleanAppUrl,
  moveApp,
  upsertApp,
  type MiniApp,
} from "./mini-apps";

// Pure helpers: the URL a save may use, the name a save may have, the tile's letter-or-emoji,
// which app the pane is showing, the upsert/move list maths and the right-click menu.

const app = (over: Partial<MiniApp>): MiniApp => ({ id: "a", name: "A", url: "https://a.test", addedAt: 0, ...over });

describe("cleanAppUrl", () => {
  it("keeps http, https and file URLs", () => {
    expect(cleanAppUrl("https://example.com/")).toBe("https://example.com/");
    expect(cleanAppUrl("http://example.com")).toBe("http://example.com/");
    expect(cleanAppUrl("file:///Users/me/page.html")).toBe("file:///Users/me/page.html");
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(cleanAppUrl("  https://example.com/  ")).toBe("https://example.com/");
  });

  it("refuses non-http(s)/file schemes and malformed strings", () => {
    expect(cleanAppUrl("about:blank")).toBeUndefined();
    expect(cleanAppUrl("data:text/plain,hi")).toBeUndefined();
    expect(cleanAppUrl("weft://foo")).toBeUndefined();
    expect(cleanAppUrl("not a url")).toBeUndefined();
  });

  it("refuses anything that isn't a string", () => {
    expect(cleanAppUrl(undefined)).toBeUndefined();
    expect(cleanAppUrl(42)).toBeUndefined();
    expect(cleanAppUrl({ href: "https://example.com" })).toBeUndefined();
  });
});

describe("cleanAppName", () => {
  it("folds whitespace and trims, then caps to MAX_APP_NAME", () => {
    expect(cleanAppName("  Bug  Fix  ")).toBe("Bug Fix");
    expect(cleanAppName("\n\there\t")).toBe("here");
  });

  it("clamps a long name to MAX_APP_NAME characters, then trims the result", () => {
    const padded = "  " + "x".repeat(MAX_APP_NAME + 20) + "  ";
    const got = cleanAppName(padded)!;
    expect(got.length).toBe(MAX_APP_NAME);
  });

  it("returns undefined for an empty, whitespace-only, or non-string name", () => {
    expect(cleanAppName("")).toBeUndefined();
    expect(cleanAppName("   ")).toBeUndefined();
    expect(cleanAppName(undefined)).toBeUndefined();
    expect(cleanAppName(null)).toBeUndefined();
    expect(cleanAppName(7)).toBeUndefined();
  });
});

describe("appNameFrom", () => {
  it("uses the title when one is given", () => {
    expect(appNameFrom("My Page", "https://x.test/foo")).toBe("My Page");
    expect(appNameFrom("  spaced  title  ", "https://x.test")).toBe("spaced title");
  });

  it("falls back to the host for a web URL", () => {
    expect(appNameFrom(undefined, "https://example.com/foo")).toBe("example.com");
    expect(appNameFrom("", "https://docs.example.com/x")).toBe("docs.example.com");
  });

  it("uses the file name without the .html/.htm for a file URL", () => {
    expect(appNameFrom(undefined, "file:///Users/me/dashboard.html")).toBe("dashboard");
    expect(appNameFrom(undefined, "file:///Users/me/Mixed_Case-Report.HTM")).toBe("Mixed Case Report");
  });

  it("returns 'App' when the URL has no useful host and no file name", () => {
    expect(appNameFrom(undefined, "file:///")).toBe("App");
    expect(appNameFrom(undefined, "not a url")).toBe("App");
    // A page with no host (about:blank) keeps its whole address.
    expect(appNameFrom(undefined, "about:blank")).toBe("about:blank");
  });
});

describe("appGlyph", () => {
  it("uppercases the first letter and tags it with a hue when it isn't an emoji", () => {
    const g = appGlyph("hello");
    expect(g.text).toBe("H");
    expect(g.emoji).toBe(false);
    expect(typeof g.hue).toBe("number");
  });

  it("passes the first character through when it is an emoji", () => {
    const g = appGlyph("🚀 launch");
    expect(g.text).toBe("🚀");
    expect(g.emoji).toBe(true);
  });

  it("uses ? for a blank or whitespace-only name", () => {
    const g = appGlyph("");
    expect(g.text).toBe("?");
    expect(g.emoji).toBe(false);
  });
});

describe("appFor", () => {
  const apps: MiniApp[] = [
    app({ id: "1", url: "https://example.com" }),
    app({ id: "2", url: "https://example.com/dashboard" }),
    app({ id: "3", url: "https://other.test/path" }),
  ];

  it("returns undefined when there is no current URL", () => {
    expect(appFor(apps, undefined)).toBeUndefined();
  });

  it("matches the exact URL when it is saved", () => {
    expect(appFor(apps, "https://example.com")?.id).toBe("1");
  });

  it("ignores a hash when matching an exact URL", () => {
    expect(appFor(apps, "https://example.com#section")?.id).toBe("1");
  });

  it("falls back to the closest saved parent URL", () => {
    expect(appFor(apps, "https://example.com/dashboard/sub")?.id).toBe("2");
  });

  it("matches a worker page by the blob it was saved from", () => {
    const sha = "a".repeat(64);
    const saved = [...apps, app({ id: "4", url: "file:///Users/me/.weft/apps/worker-aaaa/index.html", source: `blob:sha256:${sha}` })];
    expect(appFor(saved, `blob:sha256:${sha}#top`)?.id).toBe("4");
    expect(appFor(apps, `blob:sha256:${sha}`)).toBeUndefined();
  });

  it("returns undefined when nothing is close", () => {
    expect(appFor(apps, "https://nowhere.test")?.id).toBeUndefined();
  });
});

describe("upsertApp", () => {
  it("appends a new app when the URL is not yet saved", () => {
    const out = upsertApp([app({ url: "https://a.test" })], app({ id: "x", url: "https://b.test", name: "B" }));
    expect(out).toHaveLength(2);
    expect(out[1]?.name).toBe("B");
  });

  it("renames the existing app instead of duplicating when the URL is saved", () => {
    const out = upsertApp([app({ id: "x", url: "https://a.test", name: "Old" })], app({ id: "y", url: "https://a.test", name: "New" }));
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe("x");
    expect(out[0]?.name).toBe("New");
  });

  it("leaves the other apps alone when renaming one", () => {
    const out = upsertApp([app({ id: "x", url: "https://a.test", name: "A" }), app({ id: "z", url: "https://b.test", name: "B" })], app({ id: "y", url: "https://b.test", name: "New" }));
    expect(out.map((a) => a.name)).toEqual(["A", "New"]);
  });
});

describe("moveApp", () => {
  const three = [app({ id: "1" }), app({ id: "2" }), app({ id: "3" })];

  it("moves the app to the given index", () => {
    expect(moveApp(three, "1", 2).map((a) => a.id)).toEqual(["2", "3", "1"]);
    expect(moveApp(three, "3", 0).map((a) => a.id)).toEqual(["3", "1", "2"]);
  });

  it("clamps to the ends of the list", () => {
    expect(moveApp(three, "1", 99).map((a) => a.id)).toEqual(["2", "3", "1"]);
    expect(moveApp(three, "3", -5).map((a) => a.id)).toEqual(["3", "1", "2"]);
  });

  it("returns a copy of the list when the id is unknown", () => {
    expect(moveApp(three, "nope", 1).map((a) => a.id)).toEqual(["1", "2", "3"]);
  });
});

describe("appMenu", () => {
  const three = [app({ id: "1" }), app({ id: "2" }), app({ id: "3" })];

  it("enables 'up' on every position but the first, 'down' on every position but the last", () => {
    expect(appMenu(three, "1").find((i) => "id" in i && i.id === "up")?.enabled).toBe(false);
    expect(appMenu(three, "1").find((i) => "id" in i && i.id === "down")?.enabled).toBe(true);
    expect(appMenu(three, "2").find((i) => "id" in i && i.id === "up")?.enabled).toBe(true);
    expect(appMenu(three, "2").find((i) => "id" in i && i.id === "down")?.enabled).toBe(true);
    expect(appMenu(three, "3").find((i) => "id" in i && i.id === "up")?.enabled).toBe(true);
    expect(appMenu(three, "3").find((i) => "id" in i && i.id === "down")?.enabled).toBe(false);
  });

  it("falls back to 'unknown' indices when the id is not in the list", () => {
    const menu = appMenu(three, "nope");
    expect(menu.find((i) => "id" in i && i.id === "up")?.enabled).toBe(false);
    expect(menu.find((i) => "id" in i && i.id === "down")?.enabled).toBe(false);
  });

  it("lists rename, share, copy, remove and two separators", () => {
    const menu = appMenu(three, "1");
    expect(menu.map((i) => ("id" in i ? i.id : "sep"))).toEqual(["open", "rename", "share", "sep", "up", "down", "copy", "sep", "remove"]);
  });
});

describe("blobPageSha", () => {
  it("reads the sha of a worker card's page, hash or not", () => {
    const sha = "0123456789abcdef".repeat(4);
    expect(blobPageSha(`blob:sha256:${sha}`)).toBe(sha);
    expect(blobPageSha(` blob:sha256:${sha}#step-2 `)).toBe(sha);
  });

  it("is null for any other address", () => {
    expect(blobPageSha("https://example.com")).toBeNull();
    expect(blobPageSha("blob:sha256:xyz")).toBeNull();
    expect(blobPageSha(42)).toBeNull();
  });
});

describe("worker apps", () => {
  it("names a worker page's app by its sha and knows its folder", async () => {
    const { isWorkerAppFolder, workerAppId } = await import("./mini-apps");
    expect(workerAppId("0123456789abcdef".repeat(4))).toBe("worker-0123456789abcdef");
    expect(isWorkerAppFolder("/Users/me/.weft/apps/Worker-0123/")).toBe(true);
    expect(isWorkerAppFolder("worker-1")).toBe(true);
    expect(isWorkerAppFolder("/Users/me/.weft/apps/growth")).toBe(false);
    expect(isWorkerAppFolder("")).toBe(false);
  });
});
