// CLIs that print the user's own sign-in tokens: `gh auth token`, `gog auth tokens export`,
// `git credential fill`, `security find-generic-password -w`. Their output lands in the thread's
// context, and from there in the model request and its transcript for good, so the guard refuses
// the command itself, wherever it sits on the line (a red-team review, 2026-11-02). The CLIs keep
// using their stored sign-in on their own: `gh pr`, `gh api`, `gog gmail search` run as ever.
// It reads the command's words as the shell parsed them, so a commit message or PR body that only
// mentions `gh auth token` is one word of text, not a command, and isn't refused.

import os from "node:os";
import path from "node:path";

// Flags that take the next word as their value, so it isn't read as a subcommand.
const GH_VALUED = new Set(["-h", "--hostname", "-u", "--user", "-R", "--repo"]);
const GOG_VALUED = new Set(
  "-a --account --client --home --access-token --quota-project --color --enable-commands --enable-commands-exact --disable-commands --select --fields".split(" "),
);
const GCLOUD_VALUED = new Set(["--account", "--project", "--configuration", "--format", "--verbosity", "--impersonate-service-account"]);
const AWS_VALUED = new Set(["--profile", "--region", "--output", "--endpoint-url"]);
const NONE = new Set<string>();

// A command's subcommand words and its flags, values left out.
function split(args: string[], valued: Set<string>): { pos: string[]; flags: string[] } {
  const pos: string[] = [];
  const flags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") break;
    if (!a.startsWith("-")) pos.push(a);
    else {
      flags.push(a);
      if (valued.has(a)) i++;
    }
  }
  return { pos, flags };
}

const starts = (pos: string[], ...want: string[]) => want.every((w, i) => pos[i] === w);
const has = (flags: string[], re: RegExp) => flags.some((f) => re.test(f));

type Rule = { valued: Set<string>; prints: (pos: string[], flags: string[]) => string | undefined };

const RULES: Record<string, Rule> = {
  gh: {
    valued: GH_VALUED,
    prints: (pos, flags) => {
      if (starts(pos, "auth", "token")) return "gh auth token";
      if (starts(pos, "auth", "status") && has(flags, /^(-t|--show-token)$/)) return "gh auth status --show-token";
      if (starts(pos, "auth", "git-credential")) return "gh auth git-credential";
      if (starts(pos, "config", "get") && pos.includes("oauth_token")) return "gh config get oauth_token";
      return undefined;
    },
  },
  gog: {
    valued: GOG_VALUED,
    prints: (pos) => (starts(pos, "auth", "tokens", "export") ? "gog auth tokens export" : undefined),
  },
  git: {
    valued: new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]),
    prints: ([sub = "", verb = ""]) => (/^credential(-\w+)?$/.test(sub) && ["fill", "get"].includes(verb) ? `git ${sub} ${verb}` : undefined),
  },
  security: {
    valued: NONE,
    prints: ([sub = ""], flags) => {
      if (/^find-(generic|internet)-password$/.test(sub) && has(flags, /^-[a-zA-Z]*[wg]/)) return `security ${sub} -w`;
      if (sub === "dump-keychain" && has(flags, /^-[a-zA-Z]*d/)) return "security dump-keychain -d";
      return sub === "export" ? "security export" : undefined;
    },
  },
  supabase: {
    valued: new Set(["--project-ref", "--workdir", "-o", "--output", "--profile"]),
    prints: (pos) => {
      if (starts(pos, "projects", "api-keys")) return "supabase projects api-keys";
      return starts(pos, "branches", "get") ? "supabase branches get" : undefined;
    },
  },
  gcloud: {
    valued: GCLOUD_VALUED,
    prints: (pos) => {
      const at = pos[0] === "auth" ? (pos[1] === "application-default" ? 2 : 1) : -1;
      return at > 0 && /^print-(access|identity)-token$/.test(pos[at] ?? "") ? `gcloud ${pos.slice(0, at + 1).join(" ")}` : undefined;
    },
  },
  aws: {
    valued: AWS_VALUED,
    prints: (pos) => {
      if (starts(pos, "configure", "export-credentials")) return "aws configure export-credentials";
      return starts(pos, "configure", "get") && /secret|token|key_id/i.test(pos[2] ?? "") ? "aws configure get" : undefined;
    },
  },
};

const credentialRefusal = (what: string) =>
  `Weft keeps credentials out of threads, so \`${what}\` is refused: it prints a sign-in token or password, and a value ` +
  "in a thread's context goes into the model request and its transcript for good. The CLI uses its own sign-in, so run " +
  "it as usual (`gh pr`, `gh api`, `gog gmail search`). When a command needs the value itself, keep it in the 🔐 vault " +
  "and run the command with `mcp__secrets__run`.";

// Why a command (prefixes and `env` already stripped) is refused for printing a credential, or null.
export function credentialVerdict(words: string[]): string | null {
  const name = path.basename(words[0] ?? "");
  // `git-credential-osxkeychain get` is the helper git itself would run.
  if (/^git-credential-/.test(name) && words.slice(1).some((w) => w === "get")) return credentialRefusal(`${name} get`);
  const rule = RULES[name];
  if (!rule) return null;
  const { pos, flags } = split(words.slice(1), rule.valued);
  const what = rule.prints(pos, flags);
  return what ? credentialRefusal(what) : null;
}

// The files where CLIs keep their sign-in: gh's hosts.yml, git's credential store, .netrc, the Supabase and
// Vercel CLIs' tokens, gog's OAuth client and file keyring. Matched on the end of the full path, so a folder of
// the same name in a project doesn't count; the CLIs' own folders count whole, for `grep -r token ~/.config/gh`.
const CREDENTIAL_PATH =
  /(?:^|\/)(\.config\/gh(\/hosts\.ya?ml)?|\.git-credentials|\.config\/git\/credentials|\.netrc|\.supabase(\/access-token)?|com\.vercel\.cli(\/auth\.json)?|gogcli(\/(credentials\.json|keyring(\/.*)?))?)$/i;
// What a glob like `~/.config/gh/*` is tried against.
const CREDENTIAL_FILES = [
  ".config/gh/hosts.yml",
  ".git-credentials",
  ".config/git/credentials",
  ".netrc",
  ".supabase/access-token",
  "Library/Application Support/com.vercel.cli/auth.json",
  ".local/share/com.vercel.cli/auth.json",
  "Library/Application Support/gogcli/credentials.json",
  "Library/Application Support/gogcli/keyring",
].map((f) => path.join(os.homedir(), f));

// Whether an absolute path is (or a glob reaches) a CLI's credential file.
export function isCliCredential(at: string, glob?: RegExp): boolean {
  if (CREDENTIAL_PATH.test(at)) return true;
  return glob ? CREDENTIAL_FILES.some((f) => glob.test(f)) : false;
}

// For a refusal that names the file: what it is and what to do instead.
export const credentialFileRefusal = (name: string) =>
  `${name} holds a CLI's sign-in token (gh, git, gog, Supabase or Vercel), so it can't be read here. The CLI uses it ` +
  "itself: run the CLI as usual. When a command needs the value, keep it in the 🔐 vault and use `mcp__secrets__run`.";
