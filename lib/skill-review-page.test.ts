import { describe, expect, it } from "vitest";
import { esc, renderReviewPage } from "./skill-review-page";
import type { SkillReview, SkillScan } from "./types";

// The review page a skill's AI answer lands in (lib/skill-review-page.ts). Everything on it comes from an
// untrusted skill, so the tests here are mostly about what can't get through: no script, no scriptable
// content, and a CSP that turns script off entirely.

const scan = (over: Partial<SkillScan> = {}): SkillScan => ({
  verdict: "warn",
  findings: [],
  license: { spdx: "MIT", kind: "permissive" },
  hosts: [],
  files: 3,
  bytes: 2048,
  ...over,
});

const review = (over: Partial<SkillReview> = {}): SkillReview => ({
  verdict: "safe",
  summary: "A tidy helper.",
  whatItDoes: "Formats JSON.",
  concerns: [],
  falsePositives: [],
  dataFlow: "Nothing leaves the machine.",
  license: "MIT.",
  recommendation: "Install it.",
  model: "sonnet",
  reviewedAt: "2026-10-26T12:00:00.000Z",
  ...over,
});

describe("esc", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(esc("&")).toBe("&amp;");
    expect(esc("<")).toBe("&lt;");
    expect(esc(">")).toBe("&gt;");
    expect(esc('"')).toBe("&quot;");
    expect(esc("'")).toBe("&#39;");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(esc("<a><b>")).toBe("&lt;a&gt;&lt;b&gt;");
    expect(esc("&amp;")).toBe("&amp;amp;");
  });

  it("turns undefined and null into an empty string, and keeps numbers", () => {
    expect(esc(undefined)).toBe("");
    expect(esc(null as unknown as string)).toBe("");
    expect(esc(42)).toBe("42");
    expect(esc(0)).toBe("0");
  });

  it("escapes an ampersand before the other replacements, so entities aren't half-written", () => {
    // The order matters: & first, so `<` becomes &lt; and not &amp;lt;.
    expect(esc("<")).toBe("&lt;");
    expect(esc("&<")).toBe("&amp;&lt;");
  });
});

describe("renderReviewPage", () => {
  it("always carries the CSP and never a script", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan() });
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<\/script/i);
    expect(html).not.toMatch(/\son\w+=/i);
  });

  it("adds a meta refresh and the spinner text while the review runs", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan(), running: true });
    expect(html).toContain(`<meta http-equiv="refresh" content="3">`);
    expect(html).toContain("Sonnet is reading the skill");
    expect(html).toContain(`class="spin"`);
  });

  it("has no meta refresh when the review isn't running", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan() });
    expect(html).not.toContain("http-equiv=\"refresh\"");
  });

  it("shows the error's message when the review failed", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan(), error: "the reviewer died" });
    expect(html).toContain("The review didn't finish: the reviewer died");
    expect(html).toContain(`class="bad-text"`);
  });

  it("shows the verdict label and the AI section when the review is done", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan(), review: review() });
    expect(html).toContain("Looks safe");
    expect(html).toContain("A tidy helper.");
    expect(html).toContain("Formats JSON.");
    expect(html).toContain("Nothing leaves the machine.");
    expect(html).toContain("MIT.");
    expect(html).toContain("Install it.");
    expect(html).toContain("sonnet");
  });

  it("labels each verdict", () => {
    const danger = renderReviewPage({ name: "d", source: "s", scan: scan({ verdict: "danger" }), review: review({ verdict: "unsafe" }) });
    expect(danger).toContain("Danger");
    expect(danger).toContain("Unsafe");

    const caution = renderReviewPage({ name: "d", source: "s", scan: scan({ verdict: "warn" }), review: review({ verdict: "caution" }) });
    expect(caution).toContain("Worth a look");
    expect(caution).toContain("Use with care");

    const clean = renderReviewPage({ name: "d", source: "s", scan: scan({ verdict: "clean" }), review: review({ verdict: "safe" }) });
    expect(clean).toContain("Clean");
  });

  it("lists the concerns, with their severity and where they are", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan(),
      review: review({
        concerns: [
          { severity: "high", file: "scripts/run.sh", line: 12, explanation: "Runs sudo." },
          { severity: "low", explanation: "Minor." },
        ],
      }),
    });
    expect(html).toContain("Runs sudo.");
    expect(html).toContain("Minor.");
    expect(html).toContain("high");
    expect(html).toContain("low");
    expect(html).toContain("scripts/run.sh");
    expect(html).toContain(":12");
  });

  it("says there are no concerns when there are none", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan(), review: review({ concerns: [] }) });
    expect(html).toContain("No concerns.");
  });

  it("marks a finding the AI called a false positive, matched by rule and file", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan({
        findings: [{ severity: "warn", category: "code", rule: "sudo", message: "Runs commands as root", file: "README.md", line: 3, excerpt: "sudo make install" }],
      }),
      review: review({ falsePositives: [{ rule: "sudo", file: "README.md", why: "It's an install line in the docs." }] }),
    });
    expect(html).toContain(`class="fp"`);
    expect(html).toContain("✓ AI: harmless.");
    expect(html).toContain("It&#39;s an install line in the docs.");
  });

  it("matches a false positive with no file against any finding of that rule", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan({ findings: [{ severity: "warn", category: "code", rule: "sudo", message: "Runs commands as root", file: "a.sh" }] }),
      review: review({ falsePositives: [{ rule: "sudo", why: "Everywhere, it's fine." }] }),
    });
    expect(html).toContain(`class="fp"`);
    // The apostrophe is escaped like any other HTML-significant character.
    expect(html).toContain("Everywhere, it&#39;s fine.");
  });

  it("doesn't mark a finding whose file doesn't match the false positive's", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan({ findings: [{ severity: "warn", category: "code", rule: "sudo", message: "Runs commands as root", file: "a.sh" }] }),
      review: review({ falsePositives: [{ rule: "sudo", file: "b.sh", why: "Not this one." }] }),
    });
    expect(html).not.toContain(`class="fp"`);
    expect(html).not.toContain("Not this one.");
  });

  it("doesn't mark a finding whose rule doesn't match the false positive's", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan({ findings: [{ severity: "warn", category: "code", rule: "sudo", message: "Runs commands as root", file: "a.sh" }] }),
      review: review({ falsePositives: [{ rule: "credentials", file: "a.sh", why: "Different rule." }] }),
    });
    expect(html).not.toContain(`class="fp"`);
  });

  it("escapes a malicious excerpt in a finding", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan({
        findings: [{ severity: "danger", category: "prompt", rule: "x", message: "bad", file: "SKILL.md", excerpt: "<script>alert(1)</script>" }],
      }),
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes a malicious summary, name and source", () => {
    const html = renderReviewPage({
      name: "<script>alert('n')</script>",
      source: "<script>alert('s')</script>",
      scan: scan(),
      review: review({ summary: "<script>alert('sum')</script>" }),
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;n&#39;)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;s&#39;)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;sum&#39;)&lt;/script&gt;");
  });

  it("escapes a malicious finding message, concern and false-positive reason", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan({ findings: [{ severity: "warn", category: "code", rule: "x", message: "<b>m</b>", file: "<i>f</i>" }] }),
      review: review({
        concerns: [{ severity: "medium", explanation: "<b>c</b>" }],
        falsePositives: [{ rule: "x", why: "<b>w</b>" }],
      }),
    });
    expect(html).toContain("&lt;b&gt;m&lt;/b&gt;");
    expect(html).toContain("&lt;i&gt;f&lt;/i&gt;");
    expect(html).toContain("&lt;b&gt;c&lt;/b&gt;");
    expect(html).toContain("&lt;b&gt;w&lt;/b&gt;");
    expect(html).not.toContain("<b>m</b>");
  });

  it("says the rules found nothing on a clean scan with no findings", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan({ verdict: "clean" }) });
    expect(html).toContain("The rules found nothing.");
  });

  it("keeps an info finding that is about hosts, and drops the other info ones", () => {
    const html = renderReviewPage({
      name: "demo",
      source: "skills.sh",
      scan: scan({
        findings: [
          { severity: "info", category: "telemetry", rule: "hosts", message: "Its scripts call 1 host: api.example.com" },
          { severity: "info", category: "license", rule: "license", message: "Some licence note" },
        ],
      }),
    });
    expect(html).toContain("Its scripts call 1 host: api.example.com");
    expect(html).not.toContain("Some licence note");
  });

  it("shows the scan's stats and its licence", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan({ files: 12, bytes: 100 * 1024, hosts: ["api.example.com"], license: { spdx: null, kind: "unknown" } }) });
    expect(html).toContain("12 files");
    expect(html).toContain("100 KB");
    expect(html).toContain("License: unknown");
    expect(html).toContain("1 hosts called");
  });

  it("shows the AI verdict next to the static one when a review is kept", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan(), review: review() });
    expect(html).toMatch(/Static scan .*AI .*Looks safe/);
  });

  it("has no AI section when there is no review at all", () => {
    const html = renderReviewPage({ name: "demo", source: "skills.sh", scan: scan() });
    expect(html).not.toContain("<h2>AI review");
  });
});
