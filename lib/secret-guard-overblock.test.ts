import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bashVerdict, isSecretFile, toolVerdict } from "./secret-guard";
import { refusal } from "./secret-guard-why";

// What the guard used to refuse that holds no secret (2026-11-02): text that only mentions a sealed path, a thread's
// own memory, and the words it refused things in. Each allowed case sits beside the one that must stay refused.

const DATA = "/Users/me/.weft";
const REFUSED = "can't be read";

describe("text that only mentions a sealed path", () => {
  it.each([
    'gh pr create --title "Seal the vault" --body "Reads nothing from ~/.weft/vault/ or .claude"',
    "gh pr create -t 'x' -b 'see ~/.weft/account.json and ~/.claude/settings.json'",
    "gh pr comment 12 --body='~/.weft/vault/ stays sealed'",
    "gh release create v1 --notes 'the vault (~/.weft/vault) is untouched'",
    'git commit -m "fix(guards): .claude memory and ~/.weft/vault/ wording"',
    "git commit -am 'see ~/.weft/threads'",
    "git commit -m \"$(cat <<'EOF'\nfix: ~/.weft/vault and .claude\nEOF\n)\"",
    "gh pr create --body-file - <<'EOF'\nReads nothing from ~/.weft/vault/ or ~/.claude\nEOF",
    "cat > /tmp/notes.md <<'EOF'\n~/.weft/vault/ and .claude\nEOF",
    'echo "the vault lives in ~/.weft/vault/"',
  ])("lets `%s` run", (command) => expect(bashVerdict(command, DATA)).toBeNull());

  it.each([
    // A $(…) in a message still runs, and is read as the command it is.
    'git commit -m "$(cat ~/.weft/vault/acme.json)"',
    'gh pr create --body "$(cat .env.local)"',
    "gh pr create --body-file ~/.weft/vault/acme.json",
    "git commit -F ~/.claude/settings.json",
    // Text flags only count for commands that don't run their words.
    "bash -c 'cat ~/.weft/vault/x' --body x",
    "node -e \"require('fs').readFileSync(process.env.HOME + '/.weft/vault/x')\" --title x",
    // An unquoted glob expands, so echo's one-word arguments are still paths.
    "echo ~/.weft/vault/*",
    "cat <<'EOF' | bash\ncat ~/.weft/vault/acme.json\nEOF",
    "git commit -m 'x' && cat ~/.weft/vault/acme.json",
    // Found in review: a global option's value read as the subcommand, and a switch read as a text flag.
    "git -C commit diff -m ~/.claude/settings.json",
    "git -c x=y -C commit show -m ~/.weft/threads/a.json",
    "foo --summary ~/.claude/settings.json",
    "cat --comment ~/.weft/threads/a.json",
    // Older than this change, found with it: git's -C value was read as the subcommand.
    "git -C . show HEAD:.env",
    "git -c core.pager=less -C . diff -- .env.local",
  ])("still refuses `%s`", (command) => expect(bashVerdict(command, DATA)).toContain(REFUSED));
});

describe("a thread's memory folder", () => {
  let home: string;
  let memory: string;
  beforeAll(() => {
    home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-memory-")));
    memory = path.join(home, ".claude", "projects", "-Users-me-app", "memory");
    fs.mkdirSync(memory, { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), "{}");
    fs.writeFileSync(path.join(home, ".claude", "projects", "-Users-me-app", "s.jsonl"), "{}");
    fs.symlinkSync(path.join(home, ".claude", "settings.json"), path.join(memory, "settings-link.md"));
    fs.mkdirSync(path.join(home, ".claude", "projects", "-Users-me-evil"), { recursive: true });
    fs.symlinkSync(path.join(home, ".claude"), path.join(home, ".claude", "projects", "-Users-me-evil", "memory"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it.each([
    ["Write", { file_path: "~/.claude/projects/-Users-me-app/memory/user-role.md" }],
    ["Edit", { file_path: "~/.claude/projects/-Users-me-app/memory/MEMORY.md" }],
    ["Read", { file_path: "~/.claude/projects/-Users-me-app/memory/MEMORY.md" }],
    ["Write", { file_path: "~/.claude/projects/-Users-me-new/memory/first.md" }],
    ["Bash", { command: "echo '- [Role](user-role.md) — hook' >> ~/.claude/projects/-Users-me-app/memory/MEMORY.md" }],
    ["Bash", { command: "cat ~/.claude/projects/-Users-me-app/memory/MEMORY.md" }],
    ["Bash", { command: "ls ~/.claude/projects/-Users-me-app/memory" }],
  ])("lets %s use it", (tool, input) => {
    expect(toolVerdict(tool, input, DATA)).toBeNull();
  });

  it("is open by its absolute path too", () => {
    expect(isSecretFile(path.join(memory, "a.md"), DATA)).toBe(false);
  });

  it.each([
    ["Read", { file_path: "~/.claude/settings.json" }],
    ["Write", { file_path: "~/.claude/settings.local.json" }],
    ["Write", { file_path: "~/.claude/hooks/pre.sh" }],
    ["Write", { file_path: "~/.claude/skills/x/SKILL.md" }],
    ["Read", { file_path: "~/.claude/projects/-Users-me-app/s.jsonl" }],
    ["Read", { file_path: "~/.claude/projects/-Users-me-app/memory/../s.jsonl" }],
    ["Write", { file_path: "~/.claude/projects/-Users-me-app/memory/../../../settings.json" }],
    ["Read", { file_path: "~/.claude/projects/-Users-me-app/memory/settings-link.md" }],
    ["Write", { file_path: "~/.claude/projects/-Users-me-evil/memory/settings.json" }],
    ["Read", { file_path: "~/.claude/projects/-Users-me-app/memory/.claude/settings.json" }],
    ["Read", { file_path: "~/.claude.json" }],
    ["Bash", { command: "cat ~/.claude/projects/-Users-me-app/*.jsonl" }],
    ["Bash", { command: "ls ~/.claude/projects" }],
    ["Glob", { pattern: "*", path: "~/.claude" }],
  ])("keeps %s %j sealed", (tool, input) => {
    expect(toolVerdict(tool, input, DATA)).toContain(REFUSED);
  });
});

describe("refusal", () => {
  it.each([
    [".env.local", "keeps secret values out"],
    ["/Users/me/.weft/vault/acme.json", "keeps secret values out"],
    ["/Users/me/.weft/account.json", "keeps secret values out"],
    ["/proc/1/environ", "keeps secret values out"],
    ["/Users/me/.claude/settings.json", "the CLI's own folder"],
    ["/Users/me/.claude/settings.json", "memory/, which is open"],
    ["/Users/me/.weft/attachments/pasted-image-ba4d04ab.webp", "attachments folder"],
    ["/Users/me/.weft/attachments/pasted-image-ba4d04ab.webp", "another card stays with that card"],
    ["/Users/me/.weft/threads/abc.json", "Weft's data folder"],
    ["/Users/me/.weft/board.json", "show/, apps/ and scout/"],
  ])("says what %s is", (file, words) => {
    const why = refusal(file, DATA);
    expect(why).toContain(words);
    expect(why).toContain(REFUSED);
  });

  it("names the file, and keeps literal text as it is", () => {
    expect(refusal("'/Users/me/.weft/board.json'", DATA)).toContain("`board.json`");
    expect(refusal("a `.env` file", DATA, true)).toContain("so a `.env` file can't be read here");
  });

  it("is what the guard says", () => {
    expect(bashVerdict("cat ~/.claude/settings.json", DATA)).toContain("the CLI's own folder");
    expect(toolVerdict("Read", { file_path: "/Users/me/.weft/board.json" }, DATA)).toContain("Weft's data folder");
    expect(bashVerdict("cat .env", DATA)).toContain("keeps secret values out");
  });
});
