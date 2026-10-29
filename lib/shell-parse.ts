// Reads a bash command line the way the shell would, far enough to say which command reads which file.
// Used by the secret guard (lib/secret-guard.ts): `cat > a.md <<EOF … .env … EOF` writes a page, while
// `sh -c 'cat .en""v'` reads a .env file, and only a parser tells the two apart.

import { ansiC, substituted } from "./shell-quoting";

// One simple command: its words, the files it reads with `<` and writes with `>`, what it gets on stdin from
// a heredoc or here-string, and whether its output is piped into the next command.
export interface SimpleCommand {
  words: string[];
  inputs: string[];
  outputs: string[];
  stdin: string[];
  pipes: boolean;
}

export const blankCommand = (): SimpleCommand => ({ words: [], inputs: [], outputs: [], stdin: [], pipes: false });

// Where the next word goes: a file read with <, a file written with >, a here-string, a heredoc tag.
type Target = "in" | "out" | "here" | "heredoc" | "heredoc-" | null;

class ShellParser {
  readonly commands: SimpleCommand[] = [];
  readonly nested: string[] = [];
  private cmd = blankCommand();
  private word = "";
  private inWord = false;
  private target: Target = null;
  private heredocs: { tag: string; dash: boolean; owner: SimpleCommand }[] = [];
  private i = 0;

  private readonly handlers: Record<string, () => void> = {
    "\\": () => this.escape(),
    "'": () => this.singleQuoted(),
    '"': () => this.doubleQuoted(),
    "`": () => this.addNested(this.backticks()),
    $: () => this.dollar(),
    "<": () => this.lessThan(),
    ">": () => this.greaterThan(),
    "&": () => this.ampersand(),
    "|": () => this.pipe(),
    ";": () => this.separator(),
    "(": () => this.separator(),
    ")": () => this.separator(),
    "\n": () => this.newline(),
    "#": () => this.hash(),
    " ": () => this.space(),
    "\t": () => this.space(),
  };

  // A plain field, not a parameter property: Node's type stripping (scripts/import-check-hook.mjs) can't run those.
  private readonly src: string;
  constructor(src: string) {
    this.src = src;
  }

  parse(): { commands: SimpleCommand[]; nested: string[] } {
    while (this.i < this.src.length) (this.handlers[this.at()] ?? (() => this.plain()))();
    this.endCommand();
    return { commands: this.commands, nested: this.nested };
  }

  private at(offset = 0): string {
    return this.src[this.i + offset] ?? "";
  }

  private plain() {
    this.word += this.at();
    this.inWord = true;
    this.i++;
  }

  private escape() {
    if (this.at(1) !== "\n") {
      this.word += this.at(1);
      this.inWord = true;
    }
    this.i += 2;
  }

  private singleQuoted() {
    const end = this.src.indexOf("'", this.i + 1);
    const stop = end < 0 ? this.src.length : end;
    this.word += this.src.slice(this.i + 1, stop);
    this.inWord = true;
    this.i = stop + 1;
  }

  // Inside double quotes $(…) and `…` still run.
  private doubleQuoted() {
    this.i++;
    while (this.i < this.src.length && this.at() !== '"') {
      if (this.at() === "\\") {
        this.word += this.at(1);
        this.i += 2;
      } else if (this.src.startsWith("$(", this.i)) {
        this.i += 2;
        const inner = this.group();
        this.nested.push(inner);
        this.addTokens(substituted(inner));
      } else if (this.at() === "`") {
        const inner = this.backticks();
        this.nested.push(inner);
        this.addTokens(substituted(inner));
      } else {
        this.word += this.at();
        this.i++;
      }
    }
    this.inWord = true;
    this.i++;
  }

  private dollar() {
    // $'…' is ANSI-C quoting: \x2e is a dot, and the escapes are the shell's own.
    if (this.at(1) === "'") {
      this.i += 2;
      const end = this.ansiCEnd();
      this.addTokens(ansiC(this.src.slice(this.i, end)));
      this.i = end + 1;
      this.inWord = true;
      return;
    }
    // ${…} and $NAME are the shell's own expansion; only $(…) runs a command.
    if (this.at(1) !== "(") {
      this.plain();
      return;
    }
    this.i += 2;
    const inner = this.group();
    this.addNested(inner);
  }

  private addNested(text: string) {
    this.nested.push(text);
    this.addTokens(substituted(text));
    this.inWord = true;
  }

  // Adds a substituted token to the word, kept apart from what surrounds it so the guard reads
  // it as its own word: `pre$(echo .env)` reads as `pre .env`, not `pre.env`.
  private addTokens(tokens: string) {
    if (!tokens) return;
    this.word += (this.word ? " " : "") + tokens;
  }

  // The closing quote of an ANSI-C string.
  private ansiCEnd(): number {
    let j = this.i;
    while (j < this.src.length) {
      if (this.src[j] === "\\") j += 2;
      else if (this.src[j] === "'") return j;
      else j++;
    }
    return this.src.length;
  }

  // The text up to the `)` closing the one just passed, skipping quoted parts and nested pairs.
  private group(): string {
    const start = this.i;
    let depth = 1;
    while (this.i < this.src.length) {
      const c = this.at();
      if (c === "'" || c === '"') this.skipQuoted(c);
      else if (c === ")" && --depth === 0) return this.src.slice(start, this.i++);
      else {
        if (c === "(") depth++;
        this.i += c === "\\" ? 2 : 1;
      }
    }
    return this.src.slice(start);
  }

  private skipQuoted(quote: string) {
    const end = this.src.indexOf(quote, this.i + 1);
    this.i = end < 0 ? this.src.length : end + 1;
  }

  private backticks(): string {
    const end = this.src.indexOf("`", this.i + 1);
    const stop = end < 0 ? this.src.length : end;
    const inner = this.src.slice(this.i + 1, stop);
    this.i = stop + 1;
    return inner;
  }

  // <file, <<EOF, <<-EOF, <<<word, <&3 and <(…).
  private lessThan() {
    if (this.at(1) === "(") {
      this.processSubstitution();
      return;
    }
    this.endBeforeRedirect();
    const forms: [string, Target][] = [["<<<", "here"], ["<<-", "heredoc-"], ["<<", "heredoc"], ["<&", null], ["<", "in"]];
    const [op, target] = forms.find(([o]) => this.src.startsWith(o, this.i)) ?? ["<", "in"];
    this.i += op.length;
    this.target = target;
    if (op === "<&") this.skipFd();
  }

  // >file, >>file, >|file, &>file, 2>&1 and >(…).
  private greaterThan() {
    if (this.at(1) === "(") {
      this.processSubstitution();
      return;
    }
    this.endBeforeRedirect();
    this.i++;
    while (this.at() === ">" || this.at() === "|") this.i++;
    if (this.at() !== "&") {
      this.target = "out";
      return;
    }
    this.i++;
    this.skipFd();
  }

  private ampersand() {
    if (this.at(1) !== ">") {
      this.separator();
      return;
    }
    this.i++;
    this.greaterThan();
  }

  private skipFd() {
    while (/[\d-]/.test(this.at())) this.i++;
  }

  private processSubstitution() {
    this.endWord();
    this.i += 2;
    this.nested.push(this.group());
  }

  private pipe() {
    if (this.at(1) === "|") {
      this.separator();
      return;
    }
    this.endCommand(true);
    this.i += this.at(1) === "&" ? 2 : 1;
  }

  private separator() {
    this.endCommand();
    this.i += this.at(1) === this.at() ? 2 : 1;
  }

  private newline() {
    this.endCommand();
    this.i++;
    this.readHeredocs();
  }

  private hash() {
    if (this.inWord) {
      this.plain();
      return;
    }
    while (this.i < this.src.length && this.at() !== "\n") this.i++;
  }

  private space() {
    this.endWord();
    this.i++;
  }

  private endWord() {
    if (!this.inWord) return;
    const { cmd, word, target } = this;
    if (target === "in") cmd.inputs.push(word);
    else if (target === "here") cmd.stdin.push(word);
    else if (target === "heredoc" || target === "heredoc-") this.heredocs.push({ tag: word, dash: target === "heredoc-", owner: cmd });
    else if (target === "out") cmd.outputs.push(word);
    else cmd.words.push(word);
    this.word = "";
    this.inWord = false;
    this.target = null;
  }

  // A redirection's fd number (the 2 in 2>) isn't a word.
  private endBeforeRedirect() {
    if (/^\d+$/.test(this.word)) {
      this.word = "";
      this.inWord = false;
    }
    this.endWord();
  }

  private endCommand(pipes = false) {
    this.endWord();
    const { cmd } = this;
    cmd.pipes = pipes;
    if (cmd.words.length || cmd.inputs.length || cmd.stdin.length) this.commands.push(cmd);
    this.cmd = blankCommand();
  }

  private readHeredocs() {
    for (const { tag, dash, owner } of this.heredocs) owner.stdin.push(this.readBody(tag, dash));
    this.heredocs = [];
  }

  private readBody(tag: string, dash: boolean): string {
    const lines: string[] = [];
    while (this.i < this.src.length) {
      const nl = this.src.indexOf("\n", this.i);
      const end = nl < 0 ? this.src.length : nl;
      const line = this.src.slice(this.i, end);
      this.i = end + 1;
      if ((dash ? line.replace(/^\t+/, "") : line) === tag) break;
      lines.push(line);
    }
    return lines.join("\n");
  }
}

// A shell command split into simple commands: quotes and backslashes join a word (so `.en''v` is `.env`),
// `#` starts a comment, a heredoc body goes to the command it feeds, and what's inside $(…), `…`, <(…) and
// >(…) comes back as nested commands of its own.
export function parseShell(src: string): { commands: SimpleCommand[]; nested: string[] } {
  return new ShellParser(src).parse();
}
