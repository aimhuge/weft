import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The folder gate reads paths a command reaches, not the ones its prose mentions (2026-11-02), and a card's own memory
// folder in ~/.claude is its own.

vi.mock("./store", () => ({ DATA_DIR: "/nonexistent/.weft", getCard: () => undefined }));
vi.mock("./settings", () => ({ allowedFolders: () => [] }));
vi.mock("./project-folders", () => ({ projectFolders: () => [] }));

const { memoryDir, outsideFolder, pathsOf, tokenContext } = await import("./folder-guard");

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "weft-folder-prose-")));
const home = path.join(root, "home");
const project = path.join(home, "work", "app");
fs.mkdirSync(project, { recursive: true });
const at = { home, free: ["/usr", "/dev"] };
const bash = (command: string) => outsideFolder("Bash", { command }, project, [], at);

describe("prose on a Bash line", () => {
  it.each([
    'gh pr create --title "Seal ~/.weft-worker" --body "Reads nothing from ~/other or ../sibling"',
    "git commit -m 'docs: ~/other moved'",
    "git commit -m \"$(cat <<'EOF'\nfix: ~/other and ~/elsewhere\nEOF\n)\"",
    'echo "path ~/.weft\\n"',
    "cat > notes.md <<'EOF'\nsee ~/other/x and /Users/zzz/y\nEOF",
  ])("asks nothing for `%s`", (command) => expect(bash(command)).toBeUndefined());

  it.each([
    ['git commit -m "$(cat ~/other/x)"', "~/other/x"],
    ['git commit -m "mention ~/other" && cat ~/other/x', "~/other/x"],
    ["cat ~/other/x > notes.md <<'EOF'\nsee ~/other/x\nEOF", "~/other/x"],
    ["bash <<'EOF'\ncat ~/other/x\nEOF", "~/other/x"],
    ["gh pr create --body-file ~/other/body.md", "~/other/body.md"],
  ])("still asks about what `%s` reaches", (command, token) => expect(bash(command)).toMatchObject({ token }));

  it("keeps a path named in prose and reached for real", () => {
    expect(pathsOf("Bash", { command: 'git commit -m "~/a" && cat ~/a' })).toEqual(["~/a"]);
    expect(pathsOf("Bash", { command: "ls ~/a" })).toEqual(["~/a"]);
  });
});

// A long agent prompt that said "-- and /* */ comments" read `/*` as a root glob, which matched /Users and /Volumes, so
// the card asked "Outside the project: use /Volumes" for a command that touched neither (2026-11-08).
describe("a prompt or a root glob on a Bash line", () => {
  it.each([
    'echo "/*"',
    "ls /*",
    'puku-cli -p "Strip -- and /* */ comments, then read ~/other/notes and /Users/zzz/y" --model puku-ai-2.8',
    "claude --prompt='see ../sibling and ~/other' --print",
    'llm -m "summarise /Users/zzz/report in two lines"',
  ])("asks nothing for `%s`", (command) => expect(bash(command)).toBeUndefined());

  it.each([
    ["cat /Users/someone/else/file", "/Users/someone/else/file"],
    ['puku-cli -p "fix it" && cat /Users/someone/else/file', "/Users/someone/else/file"],
    ['mkdir -p "/Users/zzz/My Drive/new"', "/Users/zzz/My Drive/new"],
    ['puku-cli -p "~/other/brief.md"', "~/other/brief.md"],
  ])("still asks about what `%s` reaches", (command, token) => expect(bash(command)).toMatchObject({ token }));

  it("still expands a glob below the root's first level", () => {
    expect(pathsOf("Bash", { command: "cat /Users/*/x" })).toEqual(["/Users/*/x"]);
  });
});

describe("tokenContext", () => {
  it("shows the token with a little of the line around it", () => {
    const command = `puku-cli -p "${"a ".repeat(30)}-- and /* */ comments ${"b ".repeat(30)}"`;
    expect(tokenContext(command, "/*", 8)).toEqual({ before: "… -- and ", token: "/*", after: " */ comm…" });
  });

  it("keeps a short line whole and folds its line breaks", () => {
    expect(tokenContext("cd x &&\ncat ~/a", "~/a")).toEqual({ before: "cd x && cat ", token: "~/a", after: "" });
  });

  it("is undefined for a token not on the line verbatim", () => {
    expect(tokenContext("cat ~/My\\ Drive/x", "~/My Drive/x")).toBeUndefined();
  });
});

describe("the card's memory folder", () => {
  const memory = memoryDir(project, home);

  it("is the CLI's folder for the project", () => {
    expect(memory).toBe(path.join(home, ".claude", "projects", project.replace(/[^a-zA-Z0-9]/g, "-"), "memory"));
    expect(memoryDir("/Users/me/.weft-worker/work/weft", "/Users/me")).toBe("/Users/me/.claude/projects/-Users-me--weft-worker-work-weft/memory");
  });

  it("is written with no question", () => {
    expect(outsideFolder("Write", { file_path: path.join(memory, "note.md") }, project, [], at)).toBeUndefined();
    expect(bash(`echo "- [x](x.md)" >> ${memory}/MEMORY.md`)).toBeUndefined();
  });

  it("opens nothing else in ~/.claude, nor another project's memory", () => {
    expect(outsideFolder("Write", { file_path: path.join(home, ".claude", "settings.json") }, project, [], at)).toMatchObject({ verb: "change" });
    expect(outsideFolder("Read", { file_path: path.join(home, ".claude", "projects", "-other", "memory", "a.md") }, project, [], at)).toMatchObject({ verb: "read" });
  });
});
