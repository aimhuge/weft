import { describe, expect, it } from "vitest";
import {
  generalSegment,
  generalizePath,
  isPrivateHost,
  isPublicShareable,
  noteKeyFor,
  pathMatches,
  pathSlug,
} from "./site-notes-url";

describe("generalSegment", () => {
  it("generalizes an email-shaped segment", () => {
    expect(generalSegment("person@example.com")).toBe(":email");
  });

  it("generalizes a uuid", () => {
    expect(generalSegment("123e4567-e89b-12d3-a456-426614174000")).toBe(":id");
  });

  it("generalizes a numeric segment", () => {
    expect(generalSegment("1234567890")).toBe(":id");
  });

  it("generalizes a long hex segment", () => {
    expect(generalSegment("abcdef0123456789abcdef")).toBe(":id");
  });

  it("generalizes a 20-letter supabase project ref", () => {
    expect(generalSegment("abcdefghijklmnopqrst")).toBe(":ref");
  });

  it("generalizes a prefixed id", () => {
    expect(generalSegment("acct_12345678")).toBe(":id");
  });

  it("generalizes a long mixed token", () => {
    expect(generalSegment("abc123def456ghi789jkl")).toBe(":id");
  });

  it("decodes percent escapes before matching", () => {
    expect(generalSegment("person%40example.com")).toBe(":email");
  });

  it("keeps a malformed escape as it was", () => {
    expect(generalSegment("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("keeps an ordinary segment's case, since some sites' paths are case-sensitive", () => {
    expect(generalSegment("Dashboard")).toBe("Dashboard");
  });
});

describe("generalizePath", () => {
  it("generalizes a supabase dashboard project path", () => {
    expect(generalizePath("/dashboard/project/abcdefghijklmnopqrst/settings/api", "supabase.com")).toBe(
      "/dashboard/project/:ref/settings/api",
    );
  });

  it("generalizes owner and repo on github", () => {
    expect(generalizePath("/acme/repo/settings", "github.com")).toBe("/:owner/:repo/settings");
  });

  it("generalizes owner and repo on a github subdomain", () => {
    expect(generalizePath("/acme/repo", "gist.github.com")).toBe("/:owner/:repo");
  });

  it("leaves site words alone on owner-first hosts", () => {
    expect(generalizePath("/settings", "github.com")).toBe("/settings");
    expect(generalizePath("/dashboard/apps", "github.com")).toBe("/dashboard/apps");
  });

  it("names a segment after org or team words on any host", () => {
    expect(generalizePath("/org/acme-inc/settings", "example.com")).toBe("/org/:name/settings");
    expect(generalizePath("/teams/my-team/members", "example.com")).toBe("/teams/:name/members");
    expect(generalizePath("/workspace/ws-1", "example.com")).toBe("/workspace/:name");
  });

  it("keeps the first segment when the host is not owner-first", () => {
    expect(generalizePath("/acme/repo/settings", "example.com")).toBe("/acme/repo/settings");
  });

  it("drops empty segments and leading slash", () => {
    expect(generalizePath("//a//b/", "example.com")).toBe("/a/b");
  });

  it("caps the number of segments", () => {
    const path = `/${Array.from({ length: 20 }, (_, i) => `s${i}`).join("/")}`;
    expect(generalizePath(path, "example.com").split("/").filter(Boolean)).toHaveLength(12);
  });

  it("returns root for an empty path", () => {
    expect(generalizePath("/", "example.com")).toBe("/");
    expect(generalizePath("", "example.com")).toBe("/");
  });

  it("does not treat the second segment as a repo when the first is a site word", () => {
    expect(generalizePath("/settings/general", "github.com")).toBe("/settings/general");
  });
});

describe("noteKeyFor", () => {
  it("keys an https url", () => {
    expect(noteKeyFor("https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api")).toEqual({
      host: "supabase.com",
      path: "/dashboard/project/:ref/settings/api",
    });
  });

  it("keys an http url", () => {
    expect(noteKeyFor("http://example.com/page")).toEqual({ host: "example.com", path: "/page" });
  });

  it("drops www and a trailing dot", () => {
    expect(noteKeyFor("https://www.example.com./page")).toEqual({ host: "example.com", path: "/page" });
  });

  it("ignores the query string", () => {
    expect(noteKeyFor("https://example.com/page?token=abc")).toEqual({ host: "example.com", path: "/page" });
  });

  it("returns null for an unparseable url", () => {
    expect(noteKeyFor("not a url")).toBeNull();
    expect(noteKeyFor("")).toBeNull();
  });

  it("returns null for a non-http scheme", () => {
    expect(noteKeyFor("ftp://example.com/page")).toBeNull();
    expect(noteKeyFor("file:///tmp/page")).toBeNull();
    expect(noteKeyFor("javascript:alert(1)")).toBeNull();
  });

  it("returns null for a private host", () => {
    expect(noteKeyFor("http://localhost:3000/page")).toBeNull();
    expect(noteKeyFor("http://127.0.0.1/page")).toBeNull();
  });
});

describe("isPrivateHost", () => {
  it("matches localhost names", () => {
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("0.0.0.0")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("[::1]")).toBe(true);
    expect(isPrivateHost("app.localhost")).toBe(true);
    expect(isPrivateHost("foo.local")).toBe(true);
    expect(isPrivateHost("foo.internal")).toBe(true);
    expect(isPrivateHost("foo.lan")).toBe(true);
    expect(isPrivateHost("foo.test")).toBe(true);
  });

  it("matches private ipv4 ranges", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.1.2.3")).toBe(true);
    expect(isPrivateHost("192.168.0.1")).toBe(true);
    expect(isPrivateHost("169.254.1.1")).toBe(true);
    expect(isPrivateHost("172.16.0.1")).toBe(true);
    expect(isPrivateHost("172.31.255.1")).toBe(true);
  });

  it("does not match public addresses", () => {
    expect(isPrivateHost("172.15.0.1")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("11.0.0.1")).toBe(false);
    expect(isPrivateHost("example.com")).toBe(false);
  });
});

describe("isPublicShareable", () => {
  it("rejects private hosts", () => {
    expect(isPublicShareable("localhost")).toBe(false);
  });

  it("rejects personal platform suffixes", () => {
    expect(isPublicShareable("my-app.vercel.app")).toBe(false);
    expect(isPublicShareable("x.github.io")).toBe(false);
    expect(isPublicShareable("x.supabase.co")).toBe(false);
    expect(isPublicShareable("x.pages.dev")).toBe(false);
  });

  it("rejects bare ipv4 addresses", () => {
    expect(isPublicShareable("8.8.8.8")).toBe(false);
  });

  it("rejects hosts without a dot", () => {
    expect(isPublicShareable("intranet")).toBe(false);
  });

  it("accepts an ordinary public host", () => {
    expect(isPublicShareable("example.com")).toBe(true);
    expect(isPublicShareable("docs.example.co.uk")).toBe(true);
  });
});

describe("pathMatches", () => {
  it("matches an exact path", () => {
    expect(pathMatches("/a/b", "/a/b")).toBe(true);
  });

  it("matches placeholders as one segment", () => {
    expect(pathMatches("/a/:id/b", "/a/123/b")).toBe(true);
  });

  it("does not match a different length", () => {
    expect(pathMatches("/a/b", "/a/b/c")).toBe(false);
  });

  it("does not match different literal segments", () => {
    expect(pathMatches("/a/b", "/a/c")).toBe(false);
  });

  it("ignores empty segments", () => {
    expect(pathMatches("/a/b", "//a//b//")).toBe(true);
  });
});

describe("pathSlug", () => {
  it("makes a file-safe slug", () => {
    expect(pathSlug("/dashboard/project/:ref/settings/api")).toBe("dashboard~project~_ref~settings~api");
  });

  it("trims slashes", () => {
    expect(pathSlug("/a/b/")).toBe("a~b");
  });

  it("returns _root for an empty path", () => {
    expect(pathSlug("/")).toBe("_root");
    expect(pathSlug("")).toBe("_root");
  });
});
