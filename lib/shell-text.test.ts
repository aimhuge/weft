import { describe, expect, it } from "vitest";
import { proseOf, textWords } from "./shell-text";

const textOf = (words: string[]) => [...textWords(words)].map((i) => words[i]);

describe("textWords", () => {
  it.each([
    [["gh", "pr", "create", "--title", "T", "--body", "B"], ["T", "B"]],
    [["gh", "pr", "create", "-t", "T", "-b", "B"], ["T", "B"]],
    [["gh", "release", "create", "v1", "-n", "N"], ["N"]],
    [["gh", "issue", "comment", "1", "--body=B"], ["--body=B"]],
    [["glab", "mr", "create", "-d", "D", "-t", "T"], ["D", "T"]],
    [["git", "commit", "-m", "M"], ["M"]],
    [["git", "commit", "-am", "M"], ["M"]],
    [["git", "tag", "-a", "v1", "-m", "M"], ["M"]],
    [["git", "commit", "--message", "M"], ["M"]],
    [["/usr/bin/git", "commit", "-m", "M"], ["M"]],
    [["jj", "describe", "-m", "M"], ["M"]],
    [["git", "-C", "repo", "-c", "a=b", "commit", "-m", "M"], ["M"]],
    [["echo", "a sentence", "word"], ["a sentence"]],
    [["printf", "%s\\n", "two words"], ["two words"]],
  ])("takes %j as text: %j", (words, want) => expect(textOf(words)).toEqual(want));

  it.each([
    // A file, not text: what gh and git read the body or message from.
    [["gh", "pr", "create", "--body-file", "body.md"]],
    [["git", "commit", "-F", "msg.txt"]],
    // git's -m means something else outside a message: a parent number, a rename.
    [["git", "revert", "-m", "1", "HEAD"]],
    [["git", "branch", "-m", "old", "new"]],
    [["git", "-m"]],
    // The subcommand past git's own options: `-C commit` names a folder, and diff's -m takes nothing.
    [["git", "-C", "commit", "diff", "-m", "x"]],
    [["git", "--git-dir", "commit", "show", "-m", "x"]],
    // Long text flags only for the commands that take them: elsewhere --summary may be a switch.
    [["tar", "--comment", "x", "file"]],
    [["foo", "--summary", "x"]],
    // The short forms are each command's own; elsewhere -m and -t are anything.
    [["cat", "-t", "file"]],
    [["python3", "-m", "http.server"]],
    // A shell or an interpreter runs its words, so none is text, whatever the flag.
    [["bash", "-c", "cat x", "--body", "x"]],
    [["node", "script.js", "--title", "x"]],
    [["npx", "foo", "--body", "x"]],
    // A flag with nothing after it.
    [["gh", "pr", "create", "--body"]],
    // echo's single words: an unquoted glob would expand.
    [["echo", "~/x/*"]],
    [[]],
  ])("takes nothing in %j as text", (words) => expect(textOf(words)).toEqual([]));
});

describe("proseOf", () => {
  it("collects text words past assignments, and heredocs written to a file", () => {
    expect(proseOf("A=1 git commit -m 'see ~/x'").prose).toEqual(["see ~/x"]);
    expect(proseOf("cat > page.md <<'EOF'\nsee ~/x\nEOF").prose).toEqual(["see ~/x"]);
  });

  it("leaves code alone: a heredoc fed to a shell, an interpreter or a pipe", () => {
    expect(proseOf("bash <<'EOF'\ncat ~/x\nEOF").prose).toEqual([]);
    expect(proseOf("python3 - <<'EOF'\nopen('~/x')\nEOF").prose).toEqual([]);
    expect(proseOf("cat <<'EOF' | sh\ncat ~/x\nEOF").prose).toEqual([]);
    expect(proseOf("A=1").prose).toEqual([]);
    expect(proseOf("< in.txt").prose).toEqual([]);
  });

  it("hands back nested commands for the caller to read on their own", () => {
    expect(proseOf('git commit -m "$(cat ~/x)"').nested).toEqual(["cat ~/x"]);
  });
});
