// The file-path half of the secret guard: which paths a thread may not read. The shell half lives
// in lib/secret-guard.test.ts, beside the bashVerdict and toolVerdict cases.
import { describe, expect, it } from "vitest";
import { isSecretFile } from "./secret-guard";

const DATA = "/Users/me/.weft";

describe("isSecretFile", () => {
  it.each([".env", ".env.local", "apps/web/.env.production.local", "/x/.envrc", ".dev.vars", ".env*", "'.env.local'", "/Users/me/.weft/account.json", "~/.weft/account.json",
    "/Users/me/.weft/device-key.json", "~/.weft/device-key.json", "~/.weft/vercel-token.json", "~/.weft/supabase-token.json", "~/.weft/cloudflare-token.json", "~/.weft/slack-token.json", "~/.weft/shell-token", "/Users/me/.weft/shell-token", "/Users/me/.weft/vault/acme-web.json", "~/.weft/vault/", "~/.weft/vault"])(
    "%s holds secrets",
    (file) => expect(isSecretFile(file, DATA)).toBe(true),
  );

  it.each([".env.example", ".env.local.sample", ".env.template", "env.ts", ".environment", "lib/env.test.ts", "account.json", "device-key.json", "vault/x.json", "/p/vault.json", ""])("%s doesn't", (file) =>
    expect(isSecretFile(file, DATA)).toBe(false),
  );

  // The data dir holds the control server's token, so the folder itself is a secret path and
  // everything under it is too: a walk that finds a file there reaches the master key (2026-10-28).
  it("treats the data dir and everything under it as a secret", () => {
    expect(isSecretFile("/Users/me/.weft", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/vaults.json", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/threads/abc.json", DATA)).toBe(true);
    expect(isSecretFile("~/.weft", DATA)).toBe(true);
  });

  // `show/` is where threads write the pages they render in the pane (plans, commits, how-tos,
  // answers). Sealing it made the pane's own pages unreadable and unwritable (2026-10-28).
  it("lets a thread read and write its own pane pages", () => {
    expect(isSecretFile("/Users/me/.weft/show/plan.html", DATA)).toBe(false);
    expect(isSecretFile("/Users/fotoflo/.weft/show/retention-emails/index.html", DATA)).toBe(false);
    expect(isSecretFile("~/.weft/show/index.html", DATA)).toBe(false);
    expect(isSecretFile("/Users/me/.weft/show", DATA)).toBe(false);
  });

  // The exemption is exactly `show/` and nothing else: the rest of the data dir stays sealed.
  it("still seals the rest of the data dir", () => {
    expect(isSecretFile("/Users/me/.weft/threads/abc.json", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/vault/acme.json", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/apps/app1/index.js", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/shows/plan.html", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/show/../vault/acme.json", DATA)).toBe(true);
  });

  // The CLI's own transcripts hold every secret value a thread ever saw, in plaintext (2026-10-28).
  it("treats the CLI's transcripts as a secret", () => {
    expect(isSecretFile("/Users/me/.claude", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.claude/projects/-Users-me-app/abc.jsonl", DATA)).toBe(true);
    expect(isSecretFile("~/.claude.json", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.claude/settings.json", DATA)).toBe(true);
  });

  it("finds the account file in a custom data folder", () => {
    expect(isSecretFile("/tmp/weft-data/account.json", "/tmp/weft-data")).toBe(true);
  });

  it("finds the device key and vault files in a custom data folder", () => {
    expect(isSecretFile("/tmp/weft-data/device-key.json", "/tmp/weft-data")).toBe(true);
    expect(isSecretFile("/tmp/weft-data/vault/acme.json", "/tmp/weft-data")).toBe(true);
    expect(isSecretFile("/tmp/weft-data/vault", "/tmp/weft-data")).toBe(true);
  });
});
