import { describe, expect, it } from "vitest";
import { scrubText, scrubUrl } from "./site-notes-scrub";

describe("scrubUrl", () => {
  it("keeps the host and generalizes the path", () => {
    expect(scrubUrl("https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api")).toBe(
      "https://supabase.com/dashboard/project/:ref/settings/api",
    );
  });

  it("drops the query string and the fragment", () => {
    expect(scrubUrl("https://example.com/page?token=abc&x=1#frag")).toBe("https://example.com/page");
  });

  it("lowercases the host and keeps the path's case", () => {
    expect(scrubUrl("https://WWW.Example.com/Page")).toBe("https://www.example.com/Page");
  });

  it("drops a trailing slash", () => {
    expect(scrubUrl("https://example.com/")).toBe("https://example.com");
  });

  it("returns a placeholder for a url it cannot parse", () => {
    expect(scrubUrl("not a url")).toBe("<url>");
    expect(scrubUrl("")).toBe("<url>");
  });
});

describe("scrubText", () => {
  it("scrubs a jwt", () => {
    expect(scrubText("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP here")).toBe(
      "token <token> here",
    );
  });

  it("scrubs a stripe key", () => {
    expect(scrubText("sk_live_abcdefgh12345678")).toBe("<token>");
    expect(scrubText("rk_test_abcdefgh12345678")).toBe("<token>");
    expect(scrubText("pk_live_abcdefgh12345678")).toBe("<token>");
  });

  it("scrubs other prefixed provider keys", () => {
    expect(scrubText("whsec_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("sb_secret_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("sb_publishable_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("sk-ant-api03-abcdefghijklmnopqrstuvwx")).toBe("<token>");
    expect(scrubText("sk-proj-abcdefghijklmnopqrstuvwx")).toBe("<token>");
    expect(scrubText("xai_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("gsk_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("re_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("ghs_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("ghr_abcdefghijklmnopqrst")).toBe("<token>");
    expect(scrubText("sbp_abcdefghijklmnopqrst")).toBe("<token>");
  });

  it("scrubs a github token", () => {
    expect(scrubText("ghp_abcdefghijklmnopqrstuvwxyz012345")).toBe("<token>");
    expect(scrubText("gho_abcdefghijklmnopqrstuvwxyz012345")).toBe("<token>");
    expect(scrubText("ghu_abcdefghijklmnopqrstuvwxyz012345")).toBe("<token>");
    expect(scrubText("github_pat_abcdefghijklmnopqrstuvwxyz")).toBe("<token>");
  });

  it("scrubs a slack token", () => {
    // Built at runtime so the fixture never reads as a real token to secret scanners (GitHub push protection).
    const tail = "-123456789012-abcdefghijklmnop";
    expect(scrubText("xoxb" + tail)).toBe("<token>");
    expect(scrubText("xoxp" + tail)).toBe("<token>");
  });

  it("scrubs an aws access key id", () => {
    expect(scrubText("AKIAIOSFODNN7EXAMPLE")).toBe("<token>");
  });

  it("scrubs a google api key", () => {
    expect(scrubText("AIzaSyD-abcdefghijklmnopqrstuvwxyz01234")).toBe("<token>");
  });

  it("scrubs a private key block", () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    expect(scrubText(key)).toBe("<token>");
  });

  it("scrubs an unterminated private key block", () => {
    expect(scrubText("-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA")).toBe("<token>");
  });

  it("scrubs an email", () => {
    expect(scrubText("write to person@example.com please")).toBe("write to <email> please");
  });

  it("scrubs a uuid to an id", () => {
    expect(scrubText("id 123e4567-e89b-12d3-a456-426614174000 here")).toBe("id :id here");
  });

  it("scrubs an ipv4 address", () => {
    expect(scrubText("at 192.168.1.10 now")).toBe("at <ip> now");
  });

  it("scrubs a long hex run to an id", () => {
    expect(scrubText("hash abcdef0123456789abcdef0123 here")).toBe("hash :id here");
  });

  it("scrubs a long mixed token", () => {
    expect(scrubText("id abc123def456ghi789jkl012 here")).toBe("id <token> here");
  });

  it("scrubs a phone number", () => {
    expect(scrubText("call +1 (555) 123-4567 now")).toBe("call <phone> now");
  });

  it("scrubs a url and keeps its general path", () => {
    expect(scrubText("see https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api?tab=keys now")).toBe(
      "see https://supabase.com/dashboard/project/:ref/settings/api now",
    );
  });

  it("replaces known names", () => {
    expect(scrubText("the acme project", ["acme"])).toBe("the <account> project");
  });

  it("replaces known names case-insensitively and keeps the rest", () => {
    expect(scrubText("ACME and acme", ["acme"])).toBe("<account> and <account>");
  });

  it("replaces a known name whole, not inside a word", () => {
    expect(scrubText("acme and acmed", ["acme"])).toBe("<account> and acmed");
  });

  it("ignores known names shorter than three characters", () => {
    expect(scrubText("ab and cd", ["ab", "  "])).toBe("ab and cd");
  });

  it("replaces several known names, longest first", () => {
    expect(scrubText("acme and acme corp", ["acme", "acme corp"])).toBe("<account> and <account>");
  });

  it("ignores an empty known list", () => {
    expect(scrubText("nothing to scrub")).toBe("nothing to scrub");
  });

  it("leaves a bare scheme alone (it matches no url pattern)", () => {
    expect(scrubText("go to https:// now")).toBe("go to https:// now");
  });

  it("scrubs a url it cannot parse into a placeholder", () => {
    expect(scrubText("go to https://% now")).toBe("go to <url> now");
  });

  it("scrubs secrets before the generic patterns run", () => {
    // The jwt's own parts are not long enough for the generic token rule; the jwt rule catches it whole.
    expect(scrubText("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh")).toBe("<token>");
  });

  it("leaves ordinary prose alone", () => {
    expect(scrubText("The API keys live under Settings, in the top left of the page.")).toBe(
      "The API keys live under Settings, in the top left of the page.",
    );
  });
});
