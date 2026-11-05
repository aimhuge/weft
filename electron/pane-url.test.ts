import { describe, expect, it } from "vitest";
import { addressBarUrl, normalizeUrl, tabState } from "./pane-url.cjs";

describe("addressBarUrl", () => {
  const search = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  it("opens anything that reads as an address", () => {
    expect(addressBarUrl(" https://a.b/c d ")).toBe("https://a.b/c d");
    expect(addressBarUrl("file:///a b.html")).toBe("file:///a b.html");
    expect(addressBarUrl("example.com")).toBe("https://example.com");
    expect(addressBarUrl("node.js")).toBe("https://node.js");
    expect(addressBarUrl("example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(addressBarUrl("example.com:8080/a")).toBe("https://example.com:8080/a");
    expect(addressBarUrl("localhost")).toBe("http://localhost");
    expect(addressBarUrl("localhost:3000/a")).toBe("http://localhost:3000/a");
    expect(addressBarUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(addressBarUrl("[::1]:3000")).toBe("http://[::1]:3000");
  });

  it("searches Google for everything else", () => {
    expect(addressBarUrl("asdf")).toBe(search("asdf"));
    expect(addressBarUrl("what is node.js?")).toBe(search("what is node.js?"));
    expect(addressBarUrl("note: buy milk & eggs")).toBe(search("note: buy milk & eggs"));
    expect(addressBarUrl("hello.")).toBe(search("hello."));
    expect(addressBarUrl("c++")).toBe(search("c++"));
    expect(addressBarUrl(undefined)).toBe(search(""));
  });

  it("still refuses other schemes", () => {
    expect(() => addressBarUrl("javascript:alert(1)")).toThrow(/Can't open/);
  });
});

describe("normalizeUrl", () => {
  it("keeps web, file and about addresses and fills in the rest", () => {
    expect(normalizeUrl(" https://a.b ")).toBe("https://a.b");
    expect(normalizeUrl("file:///x")).toBe("file:///x");
    expect(normalizeUrl("localhost:3000/a")).toBe("http://localhost:3000/a");
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("example.com:8080")).toBe("https://example.com:8080");
    expect(normalizeUrl(undefined)).toBe("https://");
  });

  it("refuses any other scheme", () => {
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow(/Can't open/);
  });
});

describe("tabState", () => {
  it("reports a tab's address and title", () => {
    const view = { webContents: { getURL: () => "https://a.b/", getTitle: () => "A" } };
    expect(tabState({ id: 3, view })).toEqual({ id: 3, url: "https://a.b/", title: "A" });
  });
});
