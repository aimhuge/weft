// The file-path half of the secret guard: which paths a thread may not read. The shell half lives
// in lib/secret-guard.test.ts, beside the bashVerdict and toolVerdict cases.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    expect(isSecretFile("/Users/me/.weft/shows/plan.html", DATA)).toBe(true);
    expect(isSecretFile("/Users/me/.weft/show/../vault/acme.json", DATA)).toBe(true);
  });

  // `apps/` holds the data mini apps: pages and manifests that name vault secrets by name only, so a
  // thread can build or edit one such as Growth (2026-10-29).
  it("lets a thread build and edit a mini app", () => {
    expect(isSecretFile("/Users/me/.weft/apps/growth/index.html", DATA)).toBe(false);
    expect(isSecretFile("/Users/me/.weft/apps/growth/weft-app.json", DATA)).toBe(false);
    expect(isSecretFile("~/.weft/apps/growth/index.html", DATA)).toBe(false);
    expect(isSecretFile("/Users/me/.weft/apps", DATA)).toBe(false);
  });

  // Opening `apps/` opens that folder alone: the app lists and grants beside it, and any path that
  // climbs out of it, stay sealed.
  it.each([
    "/Users/me/.weft/apps.json",
    "/Users/me/.weft/app-grants.json",
    "~/.weft/app-grants.json",
    "/Users/me/.weft/app-previews/a.png",
    "/Users/me/.weft/appsx/index.html",
    "/Users/me/.weft/apps/../vault/acme.json",
    "/Users/me/.weft/apps/../app-grants.json",
    "~/.weft/apps/../vault/acme.json",
    "~/.weft/apps/../shell-token",
    "~/.weft/show/../threads/abc.json",
    "~/.weft/apps/growth/../../attachments/x.png",
    "/Users/me/.weft/attachments/x.png",
    "/Users/me/.weft/shell-token",
  ])("still seals %s", (file) => expect(isSecretFile(file, DATA)).toBe(true));

  // A symlink in an open folder is checked at its real place: `apps/x -> ../vault` stays sealed.
  it("follows a symlink out of an open folder", () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "weft-guard-"));
    fs.mkdirSync(path.join(data, "apps", "growth"), { recursive: true });
    fs.mkdirSync(path.join(data, "vault"));
    fs.writeFileSync(path.join(data, "apps", "growth", "index.html"), "<p>hi</p>");
    fs.writeFileSync(path.join(data, "vault", "acme.json"), "{}");
    fs.symlinkSync(path.join(data, "vault"), path.join(data, "apps", "x"));
    fs.symlinkSync(path.join(data, "vault", "new.json"), path.join(data, "apps", "dangling"));
    fs.symlinkSync(path.join(data, "show"), path.join(data, "apps", "to-show"));
    fs.symlinkSync(data, path.join(data, "apps", "root"));
    fs.symlinkSync(path.join(os.tmpdir(), "project", ".env.local"), path.join(data, "apps", "env"));
    fs.symlinkSync(os.tmpdir(), path.join(data, "apps", "tmp"));
    fs.symlinkSync(path.join(data, "apps", "loop-b"), path.join(data, "apps", "loop-a"));
    fs.symlinkSync(path.join(data, "apps", "loop-a"), path.join(data, "apps", "loop-b"));
    try {
      expect(isSecretFile(path.join(data, "apps", "growth", "index.html"), data)).toBe(false);
      expect(isSecretFile(path.join(data, "apps", "x", "acme.json"), data)).toBe(true);
      expect(isSecretFile(path.join(data, "apps", "x"), data)).toBe(true);
      expect(isSecretFile(path.join(data, "apps", "dangling"), data)).toBe(true);
      expect(isSecretFile(path.join(data, "apps", "x", "new", "deep.json"), data)).toBe(true);
      expect(isSecretFile(path.join(data, "apps", "to-show", "plan.html"), data)).toBe(false);
      expect(isSecretFile(path.join(data, "apps", "new-app", "index.html"), data)).toBe(false);
      expect(isSecretFile(path.join(data, "apps", "root"), data)).toBe(true);
      expect(isSecretFile(path.join(data, "apps", "root", "shell-token"), data)).toBe(true);
      expect(isSecretFile(path.join(data, "apps", "env"), data)).toBe(true);
      expect(isSecretFile(path.join(data, "apps", "tmp", "page.html"), data)).toBe(false);
      // A loop ends; its links sit in apps/, so the path stays inside the open folder.
      expect(isSecretFile(path.join(data, "apps", "loop-a", "page.html"), data)).toBe(false);
    } finally {
      fs.rmSync(data, { recursive: true, force: true });
    }
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
