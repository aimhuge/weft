// What the editor's verbs refuse from another machine (file-policy.ts): credentials and .git for a read, and for a save
// also every agent's settings and hooks, hook managers, package.json and editor task folders.
import { describe, expect, it } from "vitest";
import { readRefusal, writeRefusal } from "./file-policy";

describe("readRefusal", () => {
  it("lets ordinary files through", () => {
    expect(readRefusal("src/a.ts")).toBeNull();
    expect(readRefusal("docs/id_card.md")).toBeNull();
    expect(readRefusal("config.json")).toBeNull();
    expect(readRefusal("")).toBeNull();
    expect(writeRefusal("/")).toBeNull();
  });

  it.each([".ssh/id_ed25519", "deploy/.aws/credentials", ".gnupg/pubring.kbx", ".kube/config", ".docker/config.json", ".config/gh/hosts.yml", ".netrc", "app/.npmrc", ".pypirc", "certs/server.PEM", "keys/id_rsa", "keys/id_rsa.pub", ".git-credentials"])(
    "refuses the credential %s",
    (file) => {
      expect(readRefusal(file)).toContain("holds credentials");
    },
  );

  it("refuses any .git, a nested one too", () => {
    expect(readRefusal("vendor/lib/.git/config")).toContain(".git");
    expect(readRefusal(".GIT/HEAD")).toContain(".git");
  });
});

describe("writeRefusal", () => {
  it("lets ordinary files through, an instructions file included", () => {
    expect(writeRefusal("src/a.ts")).toBeNull();
    expect(writeRefusal("CLAUDE.md")).toBeNull();
    expect(writeRefusal("README.md")).toBeNull();
  });

  // One per agent Weft runs: Claude Code, Codex, Goose and puku-cli, and Weft's own skills folder.
  it.each([
    [".claude/agents/x.md", ".claude"],
    [".codex/config.toml", ".codex"],
    [".goose/config.yaml", ".goose"],
    [".puku-cli/context.md", ".puku-cli"],
    [".agents/skills/x/SKILL.md", ".agents"],
    [".Gemini/settings.toml", ".gemini"],
  ])("refuses %s, an agent's settings", (file, dir) => {
    expect(writeRefusal(file)).toContain(`doesn't save into ${dir}`);
  });

  it.each(["lefthook.yml", "lefthook-local.yaml", ".lefthook.yml", ".lefthook/pre-commit/x.sh", ".pre-commit-config.yaml", ".husky/pre-push", ".githooks/pre-commit", "package.json", "packages/web/package.json"])(
    "refuses the hook manager or install script %s",
    (file) => {
      expect(writeRefusal(file)).not.toBeNull();
    },
  );

  it.each([".idea/workspace.xml", ".zed/tasks.json", ".devcontainer/devcontainer.json", ".vscode/tasks.json", ".mcp.json", ".envrc"])("refuses the editor task or agent file %s", (file) => {
    expect(writeRefusal(file)).not.toBeNull();
  });

  it("refuses a credential as a save too", () => {
    expect(writeRefusal(".npmrc")).toContain("doesn't save .npmrc");
  });
});
