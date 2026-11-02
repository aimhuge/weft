// What the editor's verbs refuse from another machine (docs/architecture/project-hosts.md, H4): plain string checks on a
// path relative to the card's folder, so a host's remoteRefusal reads them on the path a row names and lib/host-api's
// files.* read them again on the path after its realpath. Case-folded: macOS folds case, so `.Claude` is `.claude`.

// Credentials anywhere in the folder: never read or written from the network. A segment that is one of these folders,
// or a file name that matches.
const CREDENTIAL_DIRS = new Set([".ssh", ".aws", ".gnupg", ".kube"]);
const CREDENTIAL_FILES = new Set([".netrc", ".npmrc", ".pypirc", ".git-credentials"]);
const isKey = (name: string) => name.endsWith(".pem") || /^id_[a-z0-9_-]+(\.pub)?$/.test(name);

// What configures an agent or runs on its own, so a save there would widen what a card does: every agent's settings
// and hooks (Claude Code, Codex, Goose, puku-cli, Weft's own `.agents` skills, and Gemini and Cursor too), git and hook
// managers, editor tasks and dev containers, direnv.
const AGENT_DIRS = new Set([
  ".git", ".claude", ".codex", ".goose", ".puku-cli", ".agents", ".gemini", ".cursor", ".weft",
  ".githooks", ".husky", ".vscode", ".idea", ".zed", ".devcontainer",
]);
// Files that do the same wherever they sit: package.json's scripts (prepare, postinstall, simple-git-hooks) run on
// install, so the editor doesn't save one from the network at all.
const AGENT_FILES = new Set([".mcp.json", ".envrc", ".pre-commit-config.yaml", "package.json"]);
const isHookManager = (name: string) => /^\.?lefthook([-.].*)?$/.test(name);

const parts = (rel: string) => rel.split(/[\\/]+/).filter(Boolean).map((p) => p.toLowerCase());

// Why a read of this path can't go over the network, or null when it may.
export function readRefusal(rel: string): string | null {
  const segs = parts(rel);
  if (segs.includes(".git")) return "The editor doesn't open .git from another machine.";
  const dir = segs.slice(0, -1).find((p) => CREDENTIAL_DIRS.has(p));
  const name = segs.at(-1) ?? "";
  if (dir || CREDENTIAL_DIRS.has(name) || CREDENTIAL_FILES.has(name) || isKey(name) || (name === "config.json" && segs.includes(".docker")) || segs.join("/").includes(".config/gh")) {
    return `The editor doesn't open ${rel} from another machine: it holds credentials.`;
  }
  return null;
}

// Why a save can't go to this path, or null when it may.
export function writeRefusal(rel: string): string | null {
  const credentials = readRefusal(rel);
  if (credentials) return credentials.replace("doesn't open", "doesn't save");
  const segs = parts(rel);
  const dir = segs.slice(0, -1).find((p) => AGENT_DIRS.has(p) || isHookManager(p));
  if (dir) return `The editor doesn't save into ${dir} from another machine: it holds an agent's settings or hooks.`;
  const name = segs.at(-1) ?? "";
  if (AGENT_FILES.has(name) || isHookManager(name) || AGENT_DIRS.has(name)) return `The editor doesn't save ${name} from another machine: it configures the agent or runs on its own.`;
  return null;
}
