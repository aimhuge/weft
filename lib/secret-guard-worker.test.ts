// The secret guard on a Weft Worker: its home is sealed the way the data dir is, and a card's checkout stays open.
// Against a real folder tree, because the rule follows symlinks and the card's cwd.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fromCwd } from "./secret-guard-files";
import { secretGuard, toolVerdict } from "./secret-guard";

let base: string;
let wh: string;
let data: string;
let cwd: string;
const verdict = (tool: string, input: unknown) => fromCwd(cwd, () => toolVerdict(tool, input, data));
const bash = (command: string) => verdict("Bash", { command });

beforeAll(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wh-")));
  wh = path.join(base, ".weft-worker");
  data = path.join(wh, "data");
  cwd = path.join(wh, "work", "proj");
  for (const dir of [cwd, path.join(data, "show"), path.join(data, "apps", "growth"), path.join(data, "vault"), path.join(wh, "weft", "plugin")]) fs.mkdirSync(dir, { recursive: true });
  for (const file of ["worker.json", "worker.env", "seal-key.json", "github-credentials", "worker.log", "data/shell-token"]) fs.writeFileSync(path.join(wh, file), "x");
  fs.symlinkSync("../../worker.json", path.join(cwd, "innocent.txt"));
  fs.symlinkSync("../..", path.join(cwd, "up"));
  fs.symlinkSync("../../worker.env", path.join(data, "apps", "growth", "link"));
  fs.symlinkSync("../../worker.json", path.join(data, "show", "link.html"));
  fs.symlinkSync("../../new-secret.json", path.join(data, "show", "dangling.html"));
  fs.symlinkSync("../vault", path.join(data, "show", "vault"));
  vi.stubEnv("WEFT_WORKER_HOME", wh);
  vi.stubEnv("WEFT_WORKER_ROOT", "");
  vi.spyOn(os, "homedir").mockReturnValue(base);
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});

describe("a worker's home", () => {
  it.each(["worker.json", "worker.env", "seal-key.json", "github-credentials", "worker.log", "anything-new"])("refuses %s to every file tool", (name) => {
    const file = path.join(wh, name);
    for (const tool of ["Read", "Edit", "Write"]) expect(verdict(tool, { file_path: file })).toContain("can't be read");
    expect(verdict("Read", { file_path: `~/.weft-worker/${name}` })).toContain("can't be read");
    expect(verdict("Grep", { pattern: "wwk_", path: wh })).toContain("can't be read");
    expect(verdict("Glob", { pattern: "*", path: wh })).toContain("can't be read");
    expect(verdict("LS", { path: file })).toContain("can't be read");
    expect(verdict("mcp__browser__open_url", { url: `file://${file}` })).toContain("can't be read");
  });

  it.each([
    "cat ~/.weft-worker/worker.json",
    "cat $HOME/.weft-worker/worker.env",
    'cat "$HOME/.weft-worker/seal-key.json"',
    "cat ${HOME}/.weft-worker/github-credentials",
    "cat ../../worker.json",
    "cd ../.. && cat worker.json",
    "cd ..; cd ..; cat worker.json",
    "H=~/.weft-worker; cat $H/worker.json",
    "cat ~/.weft-w*/worker.json",
    "cat ~/.weft-worke?/worker.env",
    "cat ~/.{weft-worker,x}/worker.json",
    "cat ~/.WEFT-WORKER/worker.json",
    "base64 < ~/.weft-worker/worker.json",
    "find ~/.weft-worker -type f -exec cat {} \;",
    "tar cf - ~/.weft-worker",
    "rsync -a ~/.weft-worker/ /tmp/b/",
    "cp ~/.weft-worker/worker.env /tmp/x",
    "ln -s ~/.weft-worker/worker.json x",
    "echo $(cat ../../worker.env)",
    "bash -c 'cat ~/.weft-worker/worker.json'",
    "node -e \"fs.readFileSync(os.homedir() + '/.weft-worker/worker.json')\"",
    "python3 -c \"print(open('../../worker.json').read())\"",
  ])("refuses `%s`", (command) => expect(bash(command)).toContain("can't be read"));

  it("refuses the data dir by its ~ path, which the folder gate never asks about", () => {
    expect(bash("cat ~/.weft-worker/data/shell-token")).toContain("can't be read");
    expect(bash("ls ~/.weft-worker/data/vault")).toContain("can't be read");
    expect(bash("cat ~/.weft-worker/data")).toContain("can't be read");
  });

  it("follows a link out of a checkout, a repo somebody else wrote", () => {
    expect(verdict("Read", { file_path: path.join(cwd, "innocent.txt") })).toContain("can't be read");
    expect(bash("cat innocent.txt")).toContain("can't be read");
    expect(bash("cat up/worker.json")).toContain("can't be read");
    expect(verdict("Read", { file_path: path.join(data, "apps", "growth", "link") })).toContain("can't be read");
  });

  // The show folder is one of a worker's CLI working directories, so acceptEdits writes there with no prompt and this
  // guard is all that stands behind it (lib/show-dir.ts sessionDirs).
  it("opens the show folder to writes and nothing beside or above it", () => {
    for (const tool of ["Write", "Edit"]) {
      expect(verdict(tool, { file_path: path.join(data, "show", "plan.html") })).toBeNull();
      expect(verdict(tool, { file_path: path.join(data, "show", "a", "b.html") })).toBeNull();
    }
    for (const rest of ["showcase/x.html", "show.html", "board.json", "vault/x.json"]) expect(verdict("Write", { file_path: path.join(data, rest) })).toContain("can't be read");
  });

  it.each(["show/../../worker.json", "show/../board.json", "show/link.html", "show/dangling.html", "show/vault/x.json"])("won't let a write leave the show folder through %s", (rest) => {
    for (const tool of ["Write", "Edit"]) expect(verdict(tool, { file_path: `${data}/${rest}` })).toContain("can't be read");
  });

  it("ends on a link loop, quickly", () => {
    fs.symlinkSync("loop-b", path.join(cwd, "loop-a"));
    fs.symlinkSync("loop-a", path.join(cwd, "loop-b"));
    const start = Date.now();
    expect(bash("cat loop-a/page.html")).toBeNull();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("refuses from the hook, with the card's own cwd", async () => {
    const out = await secretGuard({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "cat ../../worker.json" }, cwd } as never, undefined, { signal: new AbortController().signal });
    expect(JSON.stringify(out)).toContain('"permissionDecision":"deny"');
  });

  it.each([
    ["the checkout", "Read", { file_path: "a.ts" }],
    ["a checkout's own worker.json", "Read", { file_path: "worker.json" }],
    ["a checkout's own worker.json by path", "Bash", { command: "cat ./worker.json && cat config/worker.env" }],
    ["a sibling checkout", "Bash", { command: "ls ../other" }],
    ["the work root", "Bash", { command: "ls ~/.weft-worker/work" }],
    ["a pane page", "Write", { file_path: "~/.weft-worker/data/show/plan.html" }],
    ["a mini app", "Bash", { command: "cat ~/.weft-worker/data/apps/growth/index.html" }],
    ["the skills in Weft's clone", "Bash", { command: "bash ~/.weft-worker/weft/plugin/skills/done/commit.sh 'msg' a.ts" }],
    ["a dotted glob in a project", "Bash", { command: "ls .*" }],
    ["a Glob of the project", "Glob", { pattern: "**/*.ts" }],
  ])("leaves open %s", (_what, tool, input) => expect(verdict(tool, input)).toBeNull());

  it("keeps a work root outside the home open and the home sealed", () => {
    vi.stubEnv("WEFT_WORKER_ROOT", path.join(base, "elsewhere"));
    expect(verdict("Read", { file_path: path.join(base, "elsewhere", "p", "a.ts") })).toBeNull();
    expect(verdict("Read", { file_path: path.join(wh, "work", "proj", "a.ts") })).toContain("can't be read");
    vi.stubEnv("WEFT_WORKER_ROOT", "");
  });

  it("does nothing on a machine with no worker home", () => {
    vi.stubEnv("WEFT_WORKER_HOME", path.join(base, ".no-worker"));
    expect(toolVerdict("Bash", { command: "grep -rn .no-worker docs" }, data)).toBeNull();
    vi.stubEnv("WEFT_WORKER_HOME", wh);
  });
});

// A bare listing shows the home's names and none of what's in them, so a thread can find the open folders (2026-11-02).
describe("listing a worker's home", () => {
  it.each(["ls ~/.weft-worker", "ls -la ~/.weft-worker/", "ls -la $HOME/.weft-worker", "ls ../.."])("lets `%s` run", (command) => expect(bash(command)).toBeNull());

  it("lets the LS tool list it", () => {
    expect(verdict("LS", { path: wh })).toBeNull();
    expect(verdict("LS", { path: "~/.weft-worker" })).toBeNull();
  });

  it.each([
    "ls -R ~/.weft-worker",
    "ls --recursive ~/.weft-worker",
    "ls ~/.weft-worker/*",
    "ls ~/.weft-worker/data",
    "ls ~/.weft-worker/data/vault",
    "ls ~/.weft-worker && cat ~/.weft-worker/worker.json",
    "cat ~/.weft-worker",
    "find ~/.weft-worker",
    "tar cf - ~/.weft-worker",
    "cd ~/.weft-worker && ls | xargs cat",
  ])("still refuses `%s`", (command) => expect(bash(command)).toContain("can't be read"));

  it("still refuses the other tools on it", () => {
    expect(verdict("Glob", { pattern: "**/*", path: wh })).toContain("can't be read");
    expect(verdict("Grep", { pattern: "wwk_", path: wh })).toContain("can't be read");
    expect(verdict("LS", { path: path.join(wh, "data") })).toContain("can't be read");
  });

  it("says what a sealed file in it is", () => {
    expect(bash("cat ~/.weft-worker/worker.json")).toContain("holds this Weft Worker's keys");
    expect(bash("cat ~/.weft-worker/github-credentials")).toContain("holds this Weft Worker's keys");
    expect(bash("cat ~/.weft-worker/worker.log")).toContain("this Weft Worker's own folder");
    expect(bash("cat ~/.weft-worker/worker.log")).toContain("`ls` lists the folder itself");
  });
});
