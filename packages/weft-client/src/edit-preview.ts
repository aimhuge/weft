// The shapes of a held edit's preview, in a file of types only (lib/edit-preview-types.ts re-exports them).
//
// They live apart from lib/edit-preview.ts because the thread's items carry them (ThreadItem in ./thread-items) and
// the board imports that types graph. A type-only import still makes Turbopack resolve the module for type info, and
// lib/edit-preview.ts reads the file on disk with node:fs — a browser chunk can't hold that, so the whole board
// failed to compile.

export interface DiffLine {
  kind: "+" | "-" | " ";
  text: string;
}

export interface EditPreview {
  // Relative to the card's folder when inside it.
  file: string;
  // Top-level symbols the edit touches (lib/symbols.ts via lib/claim-guard.ts), when known.
  symbols?: string[];
  added: number;
  removed: number;
  // The first DIFF_CAP lines of the diff; `more` counts the rest.
  lines: DiffLine[];
  more: number;
  // A Write to a file that isn't there yet.
  creates?: boolean;
}
