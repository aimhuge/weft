import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The folder gate reads paths a command reaches, not the ones its prose mentions (2026-11-02), and a card's own memory
// folder in ~/.claude is its own.

vi.mock("./store", () => ({ DATA_DIR: "/nonexistent/.weft", getCard: () => undefined }));
vi.mock("./settings", () => ({ allowedFolders: () => [] }));
vi.mock("./project-folders", () => ({ projectFolders: () => [] }));

const { memoryDir, outsideFolder, pathsOf } = await import("./folder-guard");

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
