// The shapes of a project intake, in a file of types only.
//
// They live here, not in lib/project-intake.ts, because the board's intake screen lists what an intake
// offered (components/IntakeDialog.tsx) and lib/client-api.ts names the type — and a client module that
// names a server module's type still makes Turbopack resolve that server module, which runs git and reads
// the project with node:child_process and node:fs. A browser chunk can't hold those, so the whole board
// failed to compile. lib/intake-scan.ts is pure (regexes in, names out), so its FoundHook is safe here.

import type { FoundHook } from "./intake-scan";

export type IntakeBlank = { name: string; hint?: string; source: string };

// What the board's intake screen lists (components/IntakeDialog.tsx): names, files, hints and routes, never a value.
export type IntakeDetails = {
  imported: { name: string; file: string }[];
  blanks: IntakeBlank[];
  hooks: FoundHook[];
};

export type IntakeResult = {
  // Values moved into the vault from these .env files.
  imported: number;
  importedFrom: string[];
  // Names now blanks in the vault, and webhooks now blanks in 🪝.
  blanks: number;
  hooks: number;
  // .env files git tracks that hold values the vault lacks: those are in history, so rotate, don't import.
  tracked: string[];
  // Left out when nothing was taken in.
  details?: IntakeDetails;
};
