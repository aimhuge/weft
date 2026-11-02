import os from "node:os";
import { describe, expect, it } from "vitest";
import { bashVerdict, isSecretFile, toolVerdict } from "./secret-guard";
import { credentialVerdict, isCliCredential } from "./secret-guard-credentials";
import { refusal } from "./secret-guard-why";

// CLIs that print the user's sign-in tokens (a red-team review, 2026-11-02).

const DATA = "/Users/me/.weft";
const HOME = os.homedir();

describe("commands that print a credential", () => {
  it.each([
    ["gh auth token", "gh auth token"],
    ["gh auth token -h github.com -u someone", "gh auth token"],
    ["gh auth status --show-token", "gh auth status --show-token"],
    ["gh auth status -h github.com -t", "gh auth status --show-token"],
    ["gh auth git-credential get", "gh auth git-credential"],
    ["gh config get -h github.com oauth_token", "gh config get oauth_token"],
    ["gog auth tokens export me@example.com --out /tmp/t.json", "gog auth tokens export"],
    ["gog -a me@example.com --client default auth tokens export me@example.com", "gog auth tokens export"],
    ["printf 'protocol=https\\nhost=github.com\\n' | git credential fill", "git credential fill"],
    ["git -C . credential-osxkeychain get", "git credential-osxkeychain get"],
    ["git credential-store get", "git credential-store get"],
    ["git-credential-osxkeychain get", "git-credential-osxkeychain get"],
    ["security find-generic-password -s gh:github.com -w", "security find-generic-password -w"],
    ["security find-internet-password -s github.com -g", "security find-internet-password -w"],
    ["security dump-keychain -d login.keychain", "security dump-keychain -d"],
    ["supabase projects api-keys --project-ref abc", "supabase projects api-keys"],
    ["supabase branches get main", "supabase branches get"],
    ["gcloud auth print-access-token", "gcloud auth print-access-token"],
    ["gcloud auth application-default print-access-token", "gcloud auth application-default print-access-token"],
    ["aws configure get aws_secret_access_key --profile dev", "aws configure get"],
    ["aws configure export-credentials", "aws configure export-credentials"],
  ])("refuses `%s`", (command, named) => {
    const why = bashVerdict(command, DATA);
    expect(why).toContain(`\`${named}\``);
    expect(why).toContain("mcp__secrets__run");
    expect(why).toContain("vault");
  });

  it.each([
    "GH_TOKEN=$(gh auth token) curl https://api.github.com",
    "echo `gh auth token`",
    "sh -c 'gh auth token'",
    "cat <<'EOF' | bash\ngh auth token\nEOF",
    "sudo env FOO=1 gh auth token",
    "/opt/homebrew/bin/gh auth token > /tmp/t",
    "npx gh auth token",
    "pnpm exec gog auth tokens export me@example.com",
    "git commit -m x && gh auth token",
    "gh auth token | pbcopy",
  ])("refuses it wherever it sits: `%s`", (command) => expect(bashVerdict(command, DATA)).toContain("Weft keeps credentials out of threads"));

  it.each([
    "gh pr create --title 'Guard gh auth token' --body 'Refuses `gh auth token` and `gog auth tokens export`'",
    "git commit -m 'fix(guards): refuse gh auth token and git credential fill'",
    "gh pr create --body-file - <<'EOF'\ngh auth token\nsecurity find-generic-password -w\nEOF",
    "cat > /tmp/notes.md <<'EOF'\ngh auth token\nEOF",
    'echo "gh auth token prints the token"',
    "gh pr view 40",
    "gh pr list --state open",
    "gh api repos/fotoflo/weft/pulls",
    "gh auth status",
    "gh auth status -h github.com",
    "gh auth login",
    "gh config get git_protocol",
    "gh issue create --title auth --body token",
    "gog gmail search 'is:unread' -a me@example.com --client default --json",
    "gog auth tokens list --json",
    "gog auth list",
    "git credential approve",
    "git config --get credential.helper",
    "security find-generic-password -s gh:github.com",
    "security list-keychains",
    "supabase projects list",
    "supabase db push",
    "gcloud auth list",
    "aws configure get region",
    "aws s3 ls",
    "grep -rn 'gh auth token' lib/",
    "rg 'gog auth tokens export' docs",
  ])("lets `%s` run", (command) => expect(bashVerdict(command, DATA)).toBeNull());

  it("reads nothing but a command's words", () => {
    expect(credentialVerdict([])).toBeNull();
    expect(credentialVerdict(["gh"])).toBeNull();
    expect(credentialVerdict(["gh", "auth", "--", "token"])).toBeNull();
    expect(credentialVerdict(["git-credential-osxkeychain", "store"])).toBeNull();
    expect(credentialVerdict(["security", "export", "-k", "login.keychain"])).toContain("`security export`");
    expect(credentialVerdict(["gcloud", "config", "print-access-token"])).toBeNull();
    expect(credentialVerdict(["gcloud", "auth"])).toBeNull();
    expect(credentialVerdict(["aws", "configure", "get"])).toBeNull();
  });
});

describe("the files CLIs keep their sign-in in", () => {
  it.each([
    "~/.config/gh/hosts.yml",
    `${HOME}/.config/gh/hosts.yaml`,
    "~/.config/gh",
    "~/.config/gh/*",
    "~/.config/g?/hosts.yml",
    "~/.git-credentials",
    "~/.config/git/credentials",
    "~/.netrc",
    "~/.supabase/access-token",
    "~/Library/Application Support/com.vercel.cli/auth.json",
    "~/.local/share/com.vercel.cli/auth.json",
    "~/Library/Application Support/gogcli/credentials.json",
    "~/Library/Application Support/gogcli/keyring/token-default-me",
    "~/Library/Application Support/gogcli",
  ])("seals %s", (file) => expect(isSecretFile(file, DATA)).toBe(true));

  it.each(["~/.config/gh/config.yml", "~/.config/git/config", "docs/hosts.yml", "supabase/config.toml", "~/.gitconfig"])("leaves %s open", (file) =>
    expect(isSecretFile(file, DATA)).toBe(false),
  );

  it.each([
    "cat ~/.config/gh/hosts.yml",
    "grep -r oauth_token ~/.config/gh",
    "cp ~/.git-credentials /tmp/x",
    "cat ~/.netrc",
    "cat ~/.config/gh/*",
    "python3 -c \"print(open('/" + HOME.slice(1) + "/.supabase/access-token').read())\"",
  ])("refuses `%s`", (command) => expect(bashVerdict(command, DATA)).toContain("holds a CLI's sign-in token"));

  it("refuses the Read tool on gh's hosts.yml, naming the file", () => {
    const why = toolVerdict("Read", { file_path: `${HOME}/.config/gh/hosts.yml` }, DATA);
    expect(why).toContain("`hosts.yml` holds a CLI's sign-in token");
    expect(why).toContain("can't be read here");
  });

  it("says what the file is", () => expect(refusal(`${HOME}/.netrc`, DATA)).toContain("mcp__secrets__run"));

  it("tries a glob against the known files", () => {
    expect(isCliCredential(`${HOME}/x`, /^nothing$/)).toBe(false);
    expect(isCliCredential(`${HOME}/.netrc`)).toBe(true);
    expect(isCliCredential("/tmp/hosts.yml")).toBe(false);
  });
});
