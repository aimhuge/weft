import type { CardsEditing, Run } from "./dev-update.cjs";

export function refusedFiles(message: string | undefined): string[] | null;
export function conflictMessage(files: string[], editors?: Record<string, string[]>): string;
export function cardsEditingFrom(options: {
  getServer?: () => { url: string } | null | undefined;
  dir: string;
  fetchImpl?: (url: string, init?: unknown) => Promise<{ json(): Promise<unknown> }>;
  headers?: unknown;
}): CardsEditing;
export function mergeOverDirty(options: {
  dir: string;
  run: Run;
  target: string;
  files: string[];
  backupRoot: string;
  cardsEditing?: CardsEditing;
  now?: () => number;
}): Promise<{ merged: string[]; backup: string }>;
