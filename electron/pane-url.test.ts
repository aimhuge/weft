// electron/pane-url.cjs: what the pane's address bar loads for what was typed.
import { describe, expect, it } from "vitest";
import { normalizeUrl, SEARCH_URL } from "./pane-url.cjs";

describe("normalizeUrl", () => {
  it("keeps a full URL as it is", () => {
    expect(normalizeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeUrl("HTTP://example.com")).toBe("HTTP://example.com");
    expect(normalizeUrl("file:///Users/me/page.html")).toBe("file:///Users/me/page.html");
    expect(normalizeUrl("about:blank")).toBe("about:blank");
  });

  it("opens localhost over http", () => {
    expect(normalizeUrl("localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(normalizeUrl("127.0.0.1")).toBe("http://127.0.0.1");
    expect(normalizeUrl("[::1]:5001")).toBe("http://[::1]:5001");
  });

  it("opens a host over https", () => {
    expect(normalizeUrl("  example.com ")).toBe("https://example.com");
    expect(normalizeUrl("docs.foo.dev/guide?q=1#top")).toBe("https://docs.foo.dev/guide?q=1#top");
    expect(normalizeUrl("10.0.0.5/admin")).toBe("https://10.0.0.5/admin");
    expect(normalizeUrl("devbox:8080")).toBe("https://devbox:8080");
    expect(normalizeUrl("my-host.local:8443/x")).toBe("https://my-host.local:8443/x");
  });

  it("searches the web for words and phrases", () => {
    expect(normalizeUrl("nextjs")).toBe(`${SEARCH_URL}nextjs`);
    expect(normalizeUrl("react useEffect cleanup")).toBe(`${SEARCH_URL}react%20useEffect%20cleanup`);
    expect(normalizeUrl("what is next.js")).toBe(`${SEARCH_URL}what%20is%20next.js`);
    expect(normalizeUrl("note: buy milk")).toBe(`${SEARCH_URL}note%3A%20buy%20milk`);
    expect(normalizeUrl("c++ & rust?")).toBe(`${SEARCH_URL}c%2B%2B%20%26%20rust%3F`);
    expect(normalizeUrl(".com")).toBe(`${SEARCH_URL}.com`);
    expect(normalizeUrl(undefined)).toBe(SEARCH_URL);
  });

  it("refuses other schemes", () => {
    expect(() => normalizeUrl("javascript:alert(1)")).toThrow("Can't open javascript:alert(1) in the browser pane");
    expect(() => normalizeUrl("chrome://settings")).toThrow("Can't open");
    expect(() => normalizeUrl("mailto:a@b.co")).toThrow("Can't open");
  });
});
