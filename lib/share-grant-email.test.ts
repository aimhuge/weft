import { describe, expect, it } from "vitest";
import { grantEmailHtml, grantEmailText, grantSubject, type GrantEmailFacts } from "./share-grant-email";

const base: GrantEmailFacts = { sharer: "Alex", sharerLogin: "fotoflo", login: "bob", title: "Fix <login> & \"more\"", emoji: "🐛", note: null, url: "https://weft.zip/s/abc?x=1&y=2" };
const mention: GrantEmailFacts = { ...base, note: "Can you <check> this?" };
const bare: GrantEmailFacts = { ...base, sharerLogin: null, emoji: null };

describe("grantSubject", () => {
  it("reads a mention as a question and a share as a thing to look at", () => {
    expect(grantSubject(mention)).toBe('Alex mentioned you in "Fix <login> & "more""');
    expect(grantSubject(base)).toBe('Alex shared a thread with you: Fix <login> & "more"');
  });
});

describe("grantEmailText", () => {
  it("quotes a mention's note with the sharer's login", () => {
    const t = grantEmailText(mention);
    expect(t).toContain("Hi @bob,");
    expect(t).toContain("Alex (@fotoflo) mentioned you in a Weft thread:");
    expect(t).toContain('  "Can you <check> this?"');
    expect(t).toContain("🐛 Fix <login>");
    expect(t).toContain(base.url);
    expect(t).toContain("because @fotoflo named you");
  });

  it("reads a share with no login and no emoji", () => {
    const t = grantEmailText(bare);
    expect(t).toContain("Alex gave you access to a Weft thread:");
    expect(t).not.toContain('  "');
    expect(t).toContain("\nFix <login>");
    expect(t).toContain("because Alex named you");
  });
});

describe("grantEmailHtml", () => {
  it("escapes the facts and quotes a mention", () => {
    const h = grantEmailHtml(mention);
    expect(h).toContain("<title>Alex mentioned you in &quot;Fix &lt;login&gt; &amp; &quot;more&quot;&quot;</title>");
    expect(h).toContain("<blockquote");
    expect(h).toContain("Can you &lt;check&gt; this?");
    expect(h).toContain("You were mentioned");
    expect(h).toContain("mentioned you in a Weft thread:");
    expect(h).toContain("Alex (@fotoflo)");
    expect(h).toContain("🐛 Fix &lt;login&gt;");
    expect(h).toContain('href="https://weft.zip/s/abc?x=1&amp;y=2"');
    expect(h).toContain('src="https://weft.zip/brand/email/mark.png"');
    expect(h).toContain("Weft · weft.zip");
    expect(h).toContain("You got this because @fotoflo named you");
    expect(h).not.toContain("<check>");
  });

  it("reads a share with no note, login or emoji", () => {
    const h = grantEmailHtml(bare);
    expect(h).not.toContain("<blockquote");
    expect(h).toContain("Shared with you");
    expect(h).toContain("gave you access to a Weft thread:");
    expect(h).toContain("Alex shared Fix &lt;login&gt; &amp; &quot;more&quot; with you on Weft.");
    expect(h).toContain("You got this because Alex named you");
    expect(h).toMatch(/color:#1d2133;">Fix &lt;login&gt;/);
  });
});
