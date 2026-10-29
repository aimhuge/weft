import { describe, expect, it } from "vitest";
import { findSecret } from "./secret-detect";

// Sample keys are built from pieces so the repo's own secret scan (gitleaks) doesn't flag this file.
const tail = "51Hx9aKdQ2mPz8vT4bN7cW3eR6yU1iO0pLsDfGhJkL";
const j = (...parts: string[]) => parts.join("");

describe("findSecret", () => {
  it.each([
    [j("sk_", "live_", tail), "a Stripe secret key"],
    [j("rk_", "test_", tail), "a Stripe secret key"],
    [j("whsec_", tail), "a Stripe webhook secret"],
    [j("ghp_", tail), "a GitHub token"],
    [j("github_pat_", tail, "_", tail), "a GitHub token"],
    [j("sk-ant-", "api03-", tail), "an Anthropic API key"],
    [j("sk-", "proj-", tail), "an OpenAI API key"],
    [j("AKIA", "IOSFODNN7EXAMPLE"), "an AWS access key"],
    [j("AIza", "SyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY"), "a Google API key"],
    [j("xoxb-", "1234567890-abcdefghij"), "a Slack token"],
    [j("re_", "123abcde_", tail), "a Resend API key"],
    [j("eyJ", "hbGciOiJIUzI1NiJ9.", "eyJ", "yb2xlIjoic2VydmljZSJ9.", tail), "a token (JWT)"],
    [j("postgres://", "user:hunter2pass@", "db.example.com:5432/app"), "a database URL with a password"],
    [j("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIE"), "a private key"],
    // The shapes the vault pentest found missing (2026-10-28).
    [j("npm_", tail.slice(0, 36)), "an npm token"],
    [j("glpat-", tail), "a GitLab token"],
    [j("SG.", "abcdefghijklmnop", ".", "qrstuvwxyz012345"), "a SendGrid API key"],
    [j("dd_api_", tail), "a Datadog API key"],
    [j("AAAA", "BcDeFgH", ":", "A".repeat(140)), "a Firebase token"],
    [j("123456789", ":AA", tail), "a Telegram bot token"],
    [j("0123456789abcdef0123456789abcdef"), "a 32-character hex key"],
    // A Supabase service-role key: the header is eyJ, but the claims start with the role, so the
    // old two-eyJ rule missed it.
    [j("eyJhbGciOiJIUzI1NiJ9.", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0.", tail), "a token (JWT)"],
  ])("spots %s", (text, kind) => {
    expect(findSecret(`here it is: ${text}`)?.kind).toBe(kind);
  });

  it("spots a .env line with a secret-sounding name", () => {
    expect(findSecret(j("FOO=bar\nexport STRIPE_SECRET", "_KEY=\"abc123def456ghi\"\n"))).toEqual({
      kind: "a secret (STRIPE_SECRET_KEY)",
      preview: "abc123de…6ghi",
      value: "abc123def456ghi",
    });
    expect(findSecret(j("DB_PASS", "WORD=hunter2!x"))?.preview).toBe("hu…");
  });

  it("masks the middle of a key", () => {
    expect(findSecret(j("sk_", "live_", tail))?.preview).toBe("sk_live_…hJkL");
    expect(findSecret(j("-----BEGIN ", "PRIVATE KEY-----"))?.preview).toBe("-----BEGIN … PRIVATE KEY-----");
  });

  it("gives the text it found, a whole private key block when it ends", () => {
    expect(findSecret(j("say sk_", "live_", tail, " ok"))?.value).toBe(j("sk_", "live_", tail));
    const block = j("-----BEGIN RSA ", "PRIVATE KEY-----\nMIIabc\n-----END RSA ", "PRIVATE KEY-----");
    expect(findSecret(`key:\n${block}\nthanks`)?.value).toBe(block);
  });

  it.each([
    "Fix the login bug in app/api/auth/route.ts",
    "const key = process.env.STRIPE_SECRET_KEY",
    "STRIPE_SECRET_KEY=your-key-here",
    "API_TOKEN=xxxxxxxxxxxx",
    "GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }}",
    "DATABASE_PASSWORD=<set me>",
    "NEXT_PUBLIC_URL=https://example.com",
    "postgres://localhost:5432/app",
    "sk_live_short",
    "the task-runner is ok",
    // A SHA-256 and a git SHA are hex too, but longer: the 32-hex rule must not bite a chunk out
    // of them.
    "sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "commit 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b",
  ])("leaves %s alone", (text) => {
    expect(findSecret(text)).toBeNull();
  });
});
