import { describe, expect, it } from "vitest";
import { desktopReturnUrl } from "./account-callback";
import { desktopReturnLink, desktopReturnPage } from "./desktop-return";

describe("desktopReturnUrl", () => {
  it("is weft.zip's /auth/desktop by default", () => {
    expect(desktopReturnUrl()).toBe("https://weft.zip/auth/desktop");
  });

  it("follows another site without a doubled slash", () => {
    expect(desktopReturnUrl("http://localhost:3000/")).toBe("http://localhost:3000/auth/desktop");
  });
});

describe("desktopReturnLink", () => {
  it("hands the code on to weft://account-callback", () => {
    expect(desktopReturnLink("https://weft.zip/auth/desktop?code=abc")).toBe("weft://account-callback?code=abc");
  });

  it("forwards Supabase's error params", () => {
    const link = new URL(desktopReturnLink("https://weft.zip/auth/desktop?error=access_denied&error_description=Nope+there"));
    expect(link.searchParams.get("error")).toBe("access_denied");
    expect(link.searchParams.get("error_description")).toBe("Nope there");
  });

  it("drops params Supabase doesn't send", () => {
    expect(desktopReturnLink("https://weft.zip/auth/desktop?code=a&evil=1")).toBe("weft://account-callback?code=a");
  });
});

describe("desktopReturnPage", () => {
  it("opens the link at once and offers a button, uncached", async () => {
    const res = desktopReturnPage("https://weft.zip/auth/desktop?code=abc");
    const html = await res.text();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(html).toContain('href="weft://account-callback?code=abc"');
    expect(html).toContain('location.href="weft://account-callback?code=abc"');
  });

  it("can't break out of the script or the attribute", async () => {
    const html = await desktopReturnPage('https://weft.zip/auth/desktop?code=%3C%2Fscript%3E%22').text();
    expect(html).not.toContain("</script>\"");
    expect(html).not.toMatch(/code=<\/script>/);
  });
});
