import { describe, expect, it } from "vitest";
import { parseShell } from "./shell-parse";

const words = (src: string) => parseShell(src).commands.map((c) => c.words);

describe("parseShell", () => {
  it("splits on separators and pipes, marking what pipes on", () => {
    const { commands } = parseShell("a 1 && b || c; d | e |& f & g");
    expect(commands.map((c) => c.words[0])).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(commands.map((c) => c.pipes)).toEqual([false, false, false, true, true, false, false]);
  });

  it("joins quoted and escaped pieces into one word", () => {
    expect(words(`cat .en''v.local ".env"\\.x 'a b' line\\\ncont`)).toEqual([["cat", ".env.local", ".env.x", "a b", "linecont"]]);
    expect(words(`echo "a \\" b"`)).toEqual([["echo", 'a " b']]);
  });

  it("keeps a # inside a word and drops a comment", () => {
    expect(words("echo a#b # c d\nls")).toEqual([["echo", "a#b"], ["ls"]]);
  });

  it("returns substitutions as nested commands, even inside double quotes", () => {
    const { commands, nested } = parseShell("echo \"x $(cat a) `cat b`\" $(cat 'c)') <(cat d) >(tee e) $HOME");
    expect(nested).toEqual(["cat a", "cat b", "cat 'c)'", "cat d", "tee e"]);
    expect(commands[0]?.words.at(-1)).toBe("$HOME");
  });

  it("files redirections apart from words", () => {
    const [cmd] = parseShell("cat 2>&1 <in.txt >out.txt >>log &>all 0<&3 >| clobber README.md").commands;
    expect(cmd?.words).toEqual(["cat", "README.md"]);
    expect(cmd?.inputs).toEqual(["in.txt"]);
    expect(cmd?.outputs).toEqual(["out.txt", "log", "all", "clobber"]); // 2>&1 and 0<&3 write no file
  });

  it("gives heredoc bodies and here-strings to the command they feed", () => {
    const { commands } = parseShell("cat > a <<A && cat <<-'B' | bash\nbody a\nA\n\tbody b\n\tB\nls <<< word");
    expect(commands[0]?.stdin).toEqual(["body a"]);
    expect(commands[1]?.stdin).toEqual(["\tbody b"]);
    expect(commands[2]?.words).toEqual(["bash"]);
    expect(commands[3]?.stdin).toEqual(["word"]);
  });

  it("copes with unterminated quotes, groups and heredocs", () => {
    expect(parseShell("echo `x").nested).toEqual(["x"]);
    expect(parseShell("echo $(a 'b").nested).toEqual(["a 'b"]);
    expect(parseShell("echo $(a (b) \\) c").nested).toEqual(["a (b) \\) c"]);
    expect(parseShell("cat <<EOF\nno end").commands[0]?.stdin).toEqual(["no end"]);
    expect(words("echo 'open")).toEqual([["echo", "open"]]);
    expect(words("")).toEqual([]);
  });

  it("marks a command a lone & sends to the background, and a ( … ) & group's last one", () => {
    const bg = (line: string) => parseShell(line).commands.map((c) => c.background === true);
    expect(bg("pnpm dev & echo hi")).toEqual([true, false]);
    expect(bg("(cd web; pnpm dev) &")).toEqual([false, true]);
    expect(bg("a && b")).toEqual([false, false]);
    expect(bg("a 2>&1 &> log")).toEqual([false]);
    expect(bg("& a")).toEqual([false]);
  });
});
