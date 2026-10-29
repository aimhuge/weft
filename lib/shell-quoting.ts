// How the shell spells a word: what a substitution stands for, and what ANSI-C quoting says.
//
// These live apart from the parser (lib/shell-parse.ts) because they answer a question of
// their own — "what text does this piece of a command line actually spell?" — and the parser
// only has to call them (2026-10-28).

// What a command substitution stands for, as far as the guard can tell: the path-like words inside
// it. `cat $(echo .env)` reads .env however the substitution is written, so the word it lands in
// has to carry `.env` with it — the guard reads words, not shell semantics.
const SUBSTITUTION_TOKEN = /[\w.~$-]*[./][\w./~$-]*/g;

// The words of a substitution's own text, minus the quotes and separators around them.
export function substituted(text: string): string {
  return [...text.matchAll(SUBSTITUTION_TOKEN)]
    .map((m) => m[0])
    .filter((t) => t.length > 1 && t !== "." && t !== "..")
    .join(" ");
}

// ANSI-C quoting: $'\x2eenv' is `.env`, and the other escapes the shell understands. The hex and
// octal ones are what a program reaches for to spell a name the guard would otherwise read.
export function ansiC(text: string): string {
  return text.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|.)/g, (whole, esc: string) => {
    if (esc[0] === "x") return String.fromCodePoint(parseInt(esc.slice(1), 16));
    if (esc[0] === "u") {
      const hex = esc[1] === "{" ? esc.slice(2, -1) : esc.slice(1);
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (/^[0-7]{1,3}$/.test(esc)) return String.fromCodePoint(parseInt(esc, 8));
    const simple: Record<string, string> = {
      n: "\n",
      t: "\t",
      r: "\r",
      a: "\x07",
      b: "\b",
      f: "\f",
      v: "\v",
      e: "\x1b",
      "\\": "\\",
      "'": "'",
      '"': '"',
      $: "$",
      "`": "`",
      "\n": "",
    };
    return simple[esc] ?? whole;
  });
}
