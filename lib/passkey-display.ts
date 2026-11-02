// How the approval sheet on sign.weft.zip draws the input a passkey signs (docs/architecture/mobile-security.md,
// "Passkey approvals"), so what it shows can't read differently from what runs: invisible format characters (\p{Cf}:
// bidi overrides, zero-width spaces, the BOM), line separators and blank-looking letters are shown as a visible
// ⟦U+XXXX⟧ mark, and a long run of spaces or tabs
// (which could push the rest of a command off screen) is collapsed to a ⟦N spaces⟧ mark. The size and line count go
// above it. Pieces, not HTML: the page puts marks in their own <span> with textContent.

export type DisplayPiece = { text: string } | { mark: string };

const LONG_RUN = 8;
// Format characters, line and paragraph separators, and the letters that draw as nothing (Hangul fillers U+115F,
// U+1160, U+3164, U+FFA0; the braille blank U+2800).
const SPECIAL = new RegExp(`([\\p{Cf}\\p{Zl}\\p{Zp}\\u115f\\u1160\\u2800\\u3164\\uffa0])|([ \\t]{${LONG_RUN},})`, "gu");

const codePoint = (ch: string) => `U+${(ch.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`;

export function displayPieces(text: string): DisplayPiece[] {
  const out: DisplayPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(SPECIAL)) {
    const index = m.index;
    if (index > at) out.push({ text: text.slice(at, index) });
    const [whole, format] = m;
    out.push({ mark: format ? `⟦${codePoint(format)}⟧` : `⟦${whole.length} ${whole.includes("\t") ? "blanks" : "spaces"}⟧` });
    at = index + whole.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

// The input as the sheet shows it: pretty JSON, every key.
export const displayInput = (input: Record<string, unknown>) => JSON.stringify(input, null, 2);

export function inputStats(input: Record<string, unknown>): string {
  const text = displayInput(input);
  const bytes = new TextEncoder().encode(text).length;
  const lines = text.split("\n").length;
  const size = bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
  return `${size}, ${lines} line${lines === 1 ? "" : "s"}`;
}
